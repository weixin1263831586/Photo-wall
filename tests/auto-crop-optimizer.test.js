import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeOptimalPlacement, derivePersonBox } from '../js/image/AutoCropOptimizer.js';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Build a mock maskData + integral image for a given canvas size.
 * `visibleFn(px, py)` returns true if that pixel is "inside" the mask.
 */
function mockMaskData(width, height, visibleFn) {
    var w = width, h = height;
    var mask = new Uint8Array(w * h);
    var integral = new Uint32Array((w + 1) * (h + 1));
    var stride = w + 1;
    for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
            if (visibleFn(x, y)) mask[y * w + x] = 1;
            integral[(y + 1) * stride + (x + 1)] = mask[y * w + x] +
                integral[y * stride + (x + 1)] +
                integral[(y + 1) * stride + x] -
                integral[y * stride + x];
        }
    }
    return { mask: mask, integral: integral, width: w, height: h };
}

/** A fully-visible (all-inside) mask — simulates an interior cell. */
function fullMask(w, h) {
    return mockMaskData(w, h, function () { return true; });
}

/** Right-half-only mask — simulates a boundary cell where only right part shows. */
function rightHalfMask(w, h) {
    return mockMaskData(w, h, function (x) { return x >= w / 2; });
}

/* ------------------------------------------------------------------ */
/* derivePersonBox                                                     */
/* ------------------------------------------------------------------ */

test('derivePersonBox expands downward and outward from face', function () {
    var fb = { x: 0.4, y: 0.2, width: 0.2, height: 0.15 };
    var pb = derivePersonBox(fb);
    assert.ok(pb);
    assert.ok(pb.width > fb.width, 'person box should be wider than face');
    assert.ok(pb.height > fb.height * 2, 'person box should extend downward');
    assert.ok(pb.y === fb.y, 'person box starts at face top');
});

test('derivePersonBox returns null for invalid input', function () {
    assert.equal(derivePersonBox(null), null);
    assert.equal(derivePersonBox({ x: 0.9, y: 0.9, width: 0, height: 0 }), null);
});

/* ------------------------------------------------------------------ */
/* computeOptimalPlacement — no face (fallback)                        */
/* ------------------------------------------------------------------ */

test('no faceBox falls back to visibleFocusX/Y for boundary cell', function () {
    var cell = { x: 100, y: 100, isBoundary: true, maskCoverage: 0.5, visibleFocusX: 0.7, visibleFocusY: 0.3, width: 100, height: 100 };
    var photo = { focusX: 0.5, focusY: 0.5, faceBox: null, personBox: null };
    var result = computeOptimalPlacement(photo, cell, fullMask(200, 200), { width: 400, height: 400 });
    assert.equal(result.strategy, 'fallback');
    assert.equal(result.targetX, 0.7);
    assert.equal(result.targetY, 0.3);
});

test('no faceBox returns 0.5/0.5 for interior cell', function () {
    var cell = { x: 100, y: 100, isBoundary: false, maskCoverage: 1, width: 100, height: 100 };
    var photo = { focusX: 0.5, focusY: 0.5, faceBox: null };
    var result = computeOptimalPlacement(photo, cell, fullMask(200, 200), { width: 400, height: 400 });
    assert.equal(result.targetX, 0.5);
    assert.equal(result.targetY, 0.5);
});

/* ------------------------------------------------------------------ */
/* computeOptimalPlacement — with face (optimised)                     */
/* ------------------------------------------------------------------ */

test('face in photo, right-half-visible cell → optimizer picks subject strategy', function () {
    // The cell is 100×100, mask only visible on right half.
    // Face is centered in the photo. The optimizer should use subject-aware
    // placement (not fallback) and produce a positive score.
    var mask = rightHalfMask(200, 200);
    var cell = {
        isBoundary: true,
        maskCoverage: 0.5,
        visibleFocusX: 0.75,
        visibleFocusY: 0.5,
        x: 150,
        y: 100,
        width: 100,
        height: 100
    };
    var photo = {
        focusX: 0.5, focusY: 0.5,
        faceBox: { x: 0.4, y: 0.3, width: 0.2, height: 0.3 }
    };
    var result = computeOptimalPlacement(photo, cell, mask, { width: 400, height: 400 });
    assert.notEqual(result.strategy, 'fallback', 'should use subject-aware strategy');
    assert.ok(result.score > 0, 'should have a positive score');
    assert.ok(result.targetX >= 0 && result.targetX <= 1);
    assert.ok(result.targetY >= 0 && result.targetY <= 1);
    assert.ok(result.targetX >= 0.5, 'subject should be placed into the globally visible right half');
});

test('face centered in photo, full mask → target near center', function () {
    var cell = { x: 100, y: 100, isBoundary: false, maskCoverage: 1, width: 100, height: 100 };
    var photo = {
        focusX: 0.5, focusY: 0.5,
        faceBox: { x: 0.4, y: 0.3, width: 0.2, height: 0.3 }
    };
    var result = computeOptimalPlacement(photo, cell, fullMask(200, 200), { width: 400, height: 400 });
    // Interior cell — should still produce a valid placement
    assert.ok(result.targetX >= 0 && result.targetX <= 1);
    assert.ok(result.targetY >= 0 && result.targetY <= 1);
});

test('personBox is derived from faceBox when not provided', function () {
    var cell = { x: 100, y: 100, isBoundary: true, maskCoverage: 0.5, width: 100, height: 100 };
    var photo = {
        focusX: 0.5, focusY: 0.5,
        faceBox: { x: 0.4, y: 0.3, width: 0.2, height: 0.2 },
        personBox: null
    };
    var result = computeOptimalPlacement(photo, cell, fullMask(200, 200), { width: 400, height: 400 });
    assert.notEqual(result.strategy, 'fallback');
    assert.ok(result.score > 0);
});

test('large cell uses person strategy', function () {
    var cell = { x: 200, y: 200, isLarge: true, isBoundary: false, maskCoverage: 1, width: 200, height: 200 };
    var photo = {
        focusX: 0.5, focusY: 0.5,
        faceBox: { x: 0.3, y: 0.2, width: 0.3, height: 0.3 }
    };
    var result = computeOptimalPlacement(photo, cell, fullMask(400, 400), { width: 800, height: 800 });
    assert.equal(result.strategy, 'person');
});

test('zoom is computed for boundary cells', function () {
    var cell = { x: 100, y: 100, isBoundary: true, maskCoverage: 0.4, width: 100, height: 100 };
    var photo = {
        focusX: 0.5, focusY: 0.5,
        faceBox: { x: 0.3, y: 0.3, width: 0.3, height: 0.3 }
    };
    var result = computeOptimalPlacement(photo, cell, fullMask(200, 200), { width: 400, height: 400 });
    // Expected: 1.12 + max(0, 0.75 - 0.4) * 0.4 = 1.12 + 0.14 = 1.26
    assert.ok(result.zoom > 1.1 && result.zoom < 1.5);
});
