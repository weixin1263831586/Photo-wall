/**
 * AutoCropOptimizer — boundary-aware subject placement.
 *
 * Instead of naively aligning the photo's focus point to the visible-region
 * centroid, this module searches a small grid of candidate placements and
 * picks the one that maximises the visible portion of the detected subject
 * (face / upper-body) inside the mask.
 *
 * It reuses the same integral-image / mask data that PhotoWall already
 * pre-computes, so every visibility query is O(1).
 */

import { photoCoverLayout } from './PhotoTransform.js';

/* Re-export of the clamp used elsewhere for self-containment. */
function clamp(value, min, max, fallback) {
    value = Number(value);
    if (!Number.isFinite(value)) value = fallback;
    return Math.max(min, Math.min(max, value));
}

function clampBox(box) {
    if (!box) return null;
    var x = clamp(box.x, 0, 1, 0);
    var y = clamp(box.y, 0, 1, 0);
    var w = clamp(box.width, 0, 1 - x, 0);
    var h = clamp(box.height, 0, 1 - y, 0);
    return w > 0 && h > 0 ? { x: x, y: y, width: w, height: h } : null;
}

function unionBoxes(boxes) {
    boxes = (Array.isArray(boxes) ? boxes : []).map(clampBox).filter(Boolean);
    if (!boxes.length) return null;
    var minX = Math.min.apply(null, boxes.map(function (box) { return box.x; }));
    var minY = Math.min.apply(null, boxes.map(function (box) { return box.y; }));
    var maxX = Math.max.apply(null, boxes.map(function (box) { return box.x + box.width; }));
    var maxY = Math.max.apply(null, boxes.map(function (box) { return box.y + box.height; }));
    return clampBox({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });
}

/**
 * Derive an approximate person / upper-body box from a face box.
 * Expands downward (torso) and slightly outward (shoulders).
 */
export function derivePersonBox(faceBox) {
    var fb = clampBox(faceBox);
    if (!fb) return null;
    var expandX = fb.width * 0.3;
    var personW = Math.min(1, fb.width + expandX * 2);
    var personH = Math.min(1 - fb.y, fb.height * 2.8);
    var px = Math.max(0, fb.x - expandX);
    return { x: px, y: fb.y, width: personW, height: personH };
}

function rotatePoint(x, y, radians) {
    var cosine = Math.cos(radians);
    var sine = Math.sin(radians);
    return { x: x * cosine - y * sine, y: x * sine + y * cosine };
}

function pointInsideCell(x, y, width, height, shape) {
    var rx = width / 2;
    var ry = height / 2;
    if (rx <= 0 || ry <= 0) return false;
    var nx = x / rx;
    var ny = y / ry;
    if (shape === 'circle') return nx * nx + ny * ny <= 1;
    if (shape === 'diamond') return Math.abs(nx) + Math.abs(ny) <= 1;
    if (shape === 'hexagon') {
        return Math.abs(ny) <= 1 && Math.abs(nx) <= Math.sqrt(3) / 2 &&
            Math.sqrt(3) * Math.abs(ny) + Math.abs(nx) <= Math.sqrt(3);
    }
    /* The heart path is concave; this implicit approximation follows the
       visible lobes and tip closely enough for crop scoring. */
    if (shape === 'heart') {
        var hx = nx * 1.15;
        var hy = -ny * 1.1 + 0.12;
        var heart = Math.pow(hx * hx + hy * hy - 1, 3) - hx * hx * hy * hy * hy;
        return heart <= 0;
    }
    return Math.abs(nx) <= 1 && Math.abs(ny) <= 1;
}

/** Map a point in the source photo to the final canvas coordinate used by
 * drawPhotoCover + PhotoWall._drawPhoto. */
function sourcePointToCanvas(layout, photo, cell, sourceX, sourceY) {
    var localX = layout.drawX + sourceX * layout.drawWidth;
    var localY = layout.drawY + sourceY * layout.drawHeight;
    if (layout.transform.flipX) localX = -localX;
    if (layout.transform.flipY) localY = -localY;
    var photoRotated = rotatePoint(localX, localY, layout.radians);
    photoRotated.x += layout.transform.offsetX * cell.width * 0.5;
    photoRotated.y += layout.transform.offsetY * cell.height * 0.5;
    var cellRotated = rotatePoint(photoRotated.x, photoRotated.y,
        (Number(cell.rotation) || 0) * Math.PI / 180);
    return {
        canvasX: (Number(cell.x) || 0) + cellRotated.x,
        canvasY: (Number(cell.y) || 0) + cellRotated.y,
        localX: photoRotated.x,
        localY: photoRotated.y
    };
}

/** Sample a normalised subject box after every transform. Sampling instead of
 * querying one axis-aligned rectangle keeps rotated cells and photos correct. */
function visibleBoxRatio(layout, photo, cell, box, maskData) {
    if (!box || !maskData || !maskData.mask) return 0;
    var samplesX = 9;
    var samplesY = 9;
    var visible = 0;
    var total = samplesX * samplesY;
    for (var iy = 0; iy < samplesY; iy++) {
        var sourceY = box.y + box.height * ((iy + 0.5) / samplesY);
        for (var ix = 0; ix < samplesX; ix++) {
            var sourceX = box.x + box.width * ((ix + 0.5) / samplesX);
            var point = sourcePointToCanvas(layout, photo, cell, sourceX, sourceY);
            if (!pointInsideCell(point.localX, point.localY, cell.width, cell.height, cell.photoShape)) continue;
            var px = Math.floor(point.canvasX);
            var py = Math.floor(point.canvasY);
            if (px < 0 || py < 0 || px >= maskData.width || py >= maskData.height) continue;
            if (maskData.mask[py * maskData.width + px]) visible++;
        }
    }
    return visible / total;
}

/**
 * Build the candidate target grid (normalised [0,1] within the cell).
 * We sample a 5×5 grid of target points centred at 0.5.
 */
function candidateTargets() {
    var offsets = [0, 0.25, 0.5, 0.75, 1.0];
    var targets = [];
    for (var iy = 0; iy < offsets.length; iy++) {
        for (var ix = 0; ix < offsets.length; ix++) {
            targets.push({ tx: offsets[ix], ty: offsets[iy] });
        }
    }
    return targets;
}

/**
 * Reproduce the photoCoverLayout geometry for a hypothetical target.
 * Returns the drawX/drawY/drawWidth/drawHeight needed to figure out where the
 * face/person box lands.
 *
 * Reuse the renderer's cover-layout calculation so crop scoring and drawing
 * cannot drift apart.
 */
function simulateLayout(imageWidth, imageHeight, cell, photo, targetX, targetY, zoom) {
    return photoCoverLayout(
        { width: imageWidth, height: imageHeight },
        cell.width,
        cell.height,
        photo,
        {
            targetX: targetX,
            targetY: targetY,
            offsetX: Number(cell.localOffsetX) || 0,
            offsetY: Number(cell.localOffsetY) || 0,
            zoom: zoom
        }
    );
}

/**
 * Score a candidate placement by how much of the subject box lands inside
 * visible mask pixels.
 */
function scoreCandidate(layout, photo, cell, faceBox, groupBox, personBox, maskData, strategy, targetX, targetY) {
    var weights = strategy === 'face' ? { face: 5, person: 1.25 } :
        strategy === 'person' ? { face: 3, person: 3.5 } : { face: 4, person: 2.5 };
    var faceVisible = visibleBoxRatio(layout, photo, cell, faceBox, maskData);
    var groupVisible = visibleBoxRatio(layout, photo, cell, groupBox, maskData);
    var personVisible = visibleBoxRatio(layout, photo, cell, personBox, maskData);
    var faceScore = weights.face * faceVisible;
    var groupScore = (strategy === 'face' ? 0.7 : 2.2) * groupVisible;
    var personScore = weights.person * personVisible;
    var visibleX = Number.isFinite(Number(cell.visibleFocusX)) ? Number(cell.visibleFocusX) : 0.5;
    var visibleY = Number.isFinite(Number(cell.visibleFocusY)) ? Number(cell.visibleFocusY) : 0.5;
    var extremePlacementPenalty = Math.hypot(targetX - visibleX, targetY - visibleY) * 0.08;
    var headRoomPenalty = Math.abs(targetY - Math.max(0, visibleY - 0.08)) * 0.12;
    var faceCutPenalty = faceVisible < 0.72 ? (0.72 - faceVisible) * 4 : 0;
    return {
        score: faceScore + groupScore + personScore - extremePlacementPenalty - headRoomPenalty - faceCutPenalty,
        faceVisible: faceVisible,
        groupVisible: groupVisible,
        personVisible: personVisible
    };
}

/**
 * Compute the optimal placement for a photo in a boundary cell.
 *
 * @param {object} photo         Photo object (must have focusX/focusY and
 *                               optionally faceBox/personBox).
 * @param {object} cell          Layout cell (isBoundary, width, height,
 *                               maskCoverage, visibleFocusX/Y).
 * @param {object} maskData      Pre-computed mask + integral from PhotoWall.
 * @param {object} imageDims     { width, height } of the decoded source image.
 * @returns {{ targetX, targetY, offsetX, offsetY, zoom, score, strategy }}
 */
export function computeOptimalPlacement(photo, cell, maskData, imageDims) {
    photo = photo || {};
    cell = cell || {};
    imageDims = imageDims || { width: 1, height: 1 };

    var faceBoxes = (Array.isArray(photo.faceBoxes) ? photo.faceBoxes : []).map(clampBox).filter(Boolean);
    var faceBox = clampBox(photo.faceBox) || faceBoxes[0] || null;
    var groupBox = clampBox(photo.faceGroupBox) || unionBoxes(faceBoxes) || faceBox;
    var personBox = clampBox(photo.personBox) || (faceBox ? derivePersonBox(faceBox) : null);
    var coverage = Number(cell.maskCoverage);
    if (!Number.isFinite(coverage)) coverage = 0.75;

    /* Strategy selection by tile size. */
    var strategy;
    if (cell.isLarge) strategy = 'person';
    else if (coverage < 0.5) strategy = 'face';
    else strategy = 'upperBody';

    /* Zoom for boundary cells matches the existing photowall logic. */
    var zoom = 1.12 + Math.max(0, 0.75 - coverage) * 0.4;

    /* --- No face: fall back to current behaviour --- */
    if (!faceBox && !personBox) {
        var visibleFocusX = Number(cell.visibleFocusX);
        var visibleFocusY = Number(cell.visibleFocusY);
        return {
            targetX: cell.isBoundary && Number.isFinite(visibleFocusX) ? visibleFocusX : 0.5,
            targetY: cell.isBoundary && Number.isFinite(visibleFocusY) ? visibleFocusY : 0.5,
            offsetX: 0,
            offsetY: 0,
            zoom: cell.isBoundary ? zoom : 1,
            score: 0,
            strategy: 'fallback',
            confidence: 0,
            reason: 'no-subject'
        };
    }

    var sourceConfidence = Number(photo.subjectConfidence);
    if (!Number.isFinite(sourceConfidence)) sourceConfidence = photo.focusSource === 'subject' ? 0.46 : 0.72;
    if (sourceConfidence < 0.35) {
        return {
            targetX: cell.isBoundary && Number.isFinite(Number(cell.visibleFocusX)) ? Number(cell.visibleFocusX) : 0.5,
            targetY: cell.isBoundary && Number.isFinite(Number(cell.visibleFocusY)) ? Number(cell.visibleFocusY) : 0.5,
            offsetX: 0,
            offsetY: 0,
            zoom: cell.isBoundary ? zoom : 1,
            score: 0,
            strategy: 'fallback',
            confidence: sourceConfidence,
            reason: 'low-confidence'
        };
    }

    /* --- Face detected: search candidate placements --- */
    var candidates = candidateTargets();
    var best = null;

    for (var i = 0; i < candidates.length; i++) {
        var c = candidates[i];
        var layout = simulateLayout(imageDims.width, imageDims.height, cell, photo, c.tx, c.ty, zoom);
        var score = scoreCandidate(layout, photo, cell, faceBox, groupBox, personBox, maskData, strategy, c.tx, c.ty);
        if (!best || score.score > best.score) {
            best = Object.assign({ targetX: c.tx, targetY: c.ty }, score);
        }
    }

    /* Also evaluate the current visible-centroid target as a candidate. */
    var vfx = Number(cell.visibleFocusX);
    var vfy = Number(cell.visibleFocusY);
    if (Number.isFinite(vfx) && Number.isFinite(vfy)) {
        var biasedY = Math.max(0, vfy - 0.08);
        var centroidLayout = simulateLayout(imageDims.width, imageDims.height, cell, photo, vfx, biasedY, zoom);
        var centroidScore = scoreCandidate(centroidLayout, photo, cell, faceBox, groupBox, personBox, maskData, strategy, vfx, biasedY);
        if (!best || centroidScore.score > best.score) {
            best = Object.assign({ targetX: vfx, targetY: biasedY }, centroidScore);
        }
    }

    var visibility = strategy === 'face' ? best.faceVisible : Math.max(best.groupVisible, best.personVisible);
    var confidence = clamp(sourceConfidence * (0.55 + visibility * 0.45), 0, 1, 0);

    return {
        targetX: best.targetX,
        targetY: best.targetY,
        offsetX: 0,
        offsetY: 0,
        zoom: zoom,
        score: best.score,
        strategy: strategy,
        confidence: confidence,
        reason: confidence < 0.45 ? 'limited-visibility' : 'subject-visible'
    };
}
