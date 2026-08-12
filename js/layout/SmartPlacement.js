function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
}

function aspectFit(photo, cell) {
    var photoAspect = Math.max(0.05, Number(photo.aspectRatio) || 1);
    var cellAspect = Math.max(0.05, cell.width / Math.max(1, cell.height));
    return Math.exp(-Math.abs(Math.log(photoAspect / cellAspect)));
}

function colourMatch(photo, cell, width, height) {
    var spatialProgress = clamp01((cell.x / Math.max(1, width)) * 0.65 + (cell.y / Math.max(1, height)) * 0.35);
    var desiredHue = spatialProgress * 360;
    var difference = Math.abs((Number(photo.hue) || 0) - desiredHue) % 360;
    return 1 - Math.min(difference, 360 - difference) / 180;
}

function focalSafety(photo, cell) {
    var cropMismatch = 1 - aspectFit(photo, cell);
    var focalOffset = Math.hypot(clamp01(photo.focusX) - 0.5, clamp01(photo.focusY) - 0.5) / Math.SQRT1_2;
    var clearance = Math.min(1, (Number(cell.boundaryDistance) || 0) / Math.max(1, Math.min(cell.width, cell.height) * 0.5));
    return clamp01(1 - cropMismatch * focalOffset * (1.2 - clearance * 0.35));
}

export function placementScore(photo, cell, context) {
    var importance = photo.featured ? 1 : 0;
    var quality = clamp01((Number(photo.sharpness) || 0) * 2.5) * 0.6 + clamp01(photo.contrast) * 0.4;
    var score =
        0.25 * colourMatch(photo, cell, context.width, context.height) +
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
    var useCount = new Uint32Array(photos.length);
    var lastPosition = new Array(photos.length);
    var assignment = new Array(cells.length);
    var cellOrder = cells.map(function (_, index) { return index; }).sort(function (a, b) {
        if (cells[a].isLarge !== cells[b].isLarge) return cells[a].isLarge ? -1 : 1;
        return (Number(cells[b].boundaryDistance) || 0) - (Number(cells[a].boundaryDistance) || 0);
    });

    cellOrder.forEach(function (cellIndex) {
        var cell = cells[cellIndex], bestPhoto = 0, bestScore = -Infinity;
        for (var photoIndex = 0; photoIndex < photos.length; photoIndex++) {
            var score = placementScore(photos[photoIndex], cell, { width: width, height: height });
            // A photo should not repeat until the other available photos have
            // had a fair chance, even when it has a strong featured bonus.
            score -= useCount[photoIndex] * 2.25;
            var previous = lastPosition[photoIndex];
            if (previous) {
                var distance = Math.hypot(cell.x - previous.x, cell.y - previous.y);
                var safeDistance = Math.max(cell.width, cell.height) * 2.5;
                if (distance < safeDistance) score -= (1 - distance / safeDistance) * 0.75;
            }
            if (score > bestScore) {
                bestScore = score;
                bestPhoto = photoIndex;
            }
        }
        assignment[cellIndex] = bestPhoto;
        useCount[bestPhoto]++;
        lastPosition[bestPhoto] = { x: cell.x, y: cell.y };
    });
    return assignment;
}
