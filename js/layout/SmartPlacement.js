function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
}

function aspectFit(photo, cell) {
    var photoAspect = Math.max(0.05, Number(photo.aspectRatio) || 1);
    var cellAspect = Math.max(0.05, cell.width / Math.max(1, cell.height));
    return Math.exp(-Math.abs(Math.log(photoAspect / cellAspect)));
}

function colourMatch(photo, cell, width, height, hueOffset) {
    var spatialProgress = clamp01((cell.x / Math.max(1, width)) * 0.65 + (cell.y / Math.max(1, height)) * 0.35);
    var desiredHue = (spatialProgress * 360 + (Number(hueOffset) || 0)) % 360;
    var difference = Math.abs((Number(photo.hue) || 0) - desiredHue) % 360;
    return 1 - Math.min(difference, 360 - difference) / 180;
}

function focalSafety(photo, cell) {
    var cropMismatch = 1 - aspectFit(photo, cell);
    var focalOffset = Math.hypot(clamp01(photo.focusX) - 0.5, clamp01(photo.focusY) - 0.5) / Math.SQRT1_2;
    var clearance = Math.min(1, (Number(cell.boundaryDistance) || 0) / Math.max(1, Math.min(cell.width, cell.height) * 0.5));
    return clamp01(1 - cropMismatch * focalOffset * (1.2 - clearance * 0.35));
}

function photoMetrics(photo) {
    var aspectRatio = Math.max(0.05, Number(photo.aspectRatio) || 1);
    var contrast = clamp01(photo.contrast);
    var sharpness = Number(photo.sharpness) || 0;
    var importance = photo.featured ? 1 : 0;
    return {
        hue: Number(photo.hue) || 0,
        logAspect: Math.log(aspectRatio),
        focalOffset: Math.hypot(clamp01(photo.focusX) - 0.5, clamp01(photo.focusY) - 0.5) / Math.SQRT1_2,
        quality: clamp01(sharpness * 2.5) * 0.6 + contrast * 0.4,
        contrast: contrast,
        importance: importance,
        subjectScore: clamp01(photo.subjectScore)
    };
}

function scoreMetrics(photo, cell) {
    var hueDifference = Math.abs(photo.hue - cell.desiredHue) % 360;
    var colour = 1 - Math.min(hueDifference, 360 - hueDifference) / 180;
    var aspect = Math.exp(-Math.abs(photo.logAspect - cell.logAspect));
    var focal = clamp01(1 - (1 - aspect) * photo.focalOffset * (1.2 - cell.clearance * 0.35));
    var score =
        0.25 * colour +
        0.18 * aspect +
        0.12 * photo.quality +
        0.10 * photo.contrast +
        0.15 * focal +
        0.20 * photo.importance;
    if (cell.isLarge) score += photo.importance ? 1.5 : photo.quality * 0.25;
    if (cell.isBoundary) score += photo.subjectScore * 0.12;
    return score;
}

export function placementScore(photo, cell, context) {
    var importance = photo.featured ? 1 : 0;
    var quality = clamp01((Number(photo.sharpness) || 0) * 2.5) * 0.6 + clamp01(photo.contrast) * 0.4;
    var score =
        0.25 * colourMatch(photo, cell, context.width, context.height, context.hueOffset) +
        0.18 * aspectFit(photo, cell) +
        0.12 * quality +
        0.10 * clamp01(photo.contrast) +
        0.15 * focalSafety(photo, cell) +
        0.20 * importance;
    if (cell.isLarge) score += importance ? 1.5 : quality * 0.25;
    return score;
}

/** Greedy global assignment with use-count and proximity penalties. */
export function assignPhotosToCells(photos, cells, options) {
    if (!photos.length) return [];
    options = options || {};
    var width = Math.max(1, Number(options.width) || 1);
    var height = Math.max(1, Number(options.height) || 1);
    var seed = (Number(options.seed) || 1) >>> 0;
    var hueOffset = (seed * 137.50776405) % 360;
    var useCount = new Uint32Array(photos.length);
    var lastPosition = new Array(photos.length);
    var assignment = new Array(cells.length);
    var remainingUnused = photos.length;
    // Normalize photo values once. The old hot loop repeatedly parsed values,
    // calculated focus offsets and allocated a context object for every
    // photo/cell pair (one million times for a 1000-photo wall).
    var normalizedPhotos = photos.map(photoMetrics);
    var normalizedCells = cells.map(function (cell) {
        var cellAspect = Math.max(0.05, cell.width / Math.max(1, cell.height));
        return {
            desiredHue: (clamp01((cell.x / width) * 0.65 + (cell.y / height) * 0.35) * 360 + hueOffset) % 360,
            logAspect: Math.log(cellAspect),
            clearance: Math.min(1, (Number(cell.boundaryDistance) || 0) /
                Math.max(1, Math.min(cell.width, cell.height) * 0.5)),
            isLarge: cell.isLarge === true,
            isBoundary: cell.isBoundary === true
        };
    });
    var cellOrder = cells.map(function (_, index) { return index; }).sort(function (a, b) {
        if (cells[a].isLarge !== cells[b].isLarge) return cells[a].isLarge ? -1 : 1;
        return (Number(cells[b].boundaryDistance) || 0) - (Number(cells[a].boundaryDistance) || 0);
    });

    cellOrder.forEach(function (cellIndex) {
        var cell = cells[cellIndex], metrics = normalizedCells[cellIndex];
        var bestPhoto = -1, bestScore = -Infinity;
        for (var photoIndex = 0; photoIndex < photos.length; photoIndex++) {
            // While unused photos remain, scanning only those both guarantees
            // fair distribution and halves the large-wall search on average.
            if (remainingUnused && useCount[photoIndex]) continue;
            var score = scoreMetrics(normalizedPhotos[photoIndex], metrics);
            if (!remainingUnused) score -= useCount[photoIndex] * 2.25;
            var previous = lastPosition[photoIndex];
            if (previous) {
                var distance = Math.hypot(cell.x - previous.x, cell.y - previous.y);
                var safeDistance = Math.max(cell.width, cell.height) * 2.5;
                if (distance < safeDistance) score -= (1 - distance / safeDistance) * 0.75;
            }
            // A stable, tiny tie-breaker makes equal-looking photos vary with
            // the project seed without overpowering the placement quality.
            score += ((((seed ^ Math.imul(photoIndex + 1, 2654435761) ^
                Math.imul(cellIndex + 1, 1597334677)) >>> 0) % 1000) / 1000) * 0.0001;
            if (score > bestScore) {
                bestScore = score;
                bestPhoto = photoIndex;
            }
        }
        // Defensive fallback for malformed input; normally the unused/full
        // pass above always selects at least one photo.
        if (bestPhoto < 0) bestPhoto = 0;
        assignment[cellIndex] = bestPhoto;
        if (useCount[bestPhoto] === 0) remainingUnused--;
        useCount[bestPhoto]++;
        lastPosition[bestPhoto] = { x: cell.x, y: cell.y };
    });
    return assignment;
}
