import test from 'node:test';
import assert from 'node:assert/strict';
import {
    addRoundedRectPath,
    applyPhotoTransform,
    normalizePhotoTransform,
    photoCoverLayout,
    SLOT_LOCAL_OFFSET_LIMIT
} from '../js/image/PhotoTransform.js';

test('photo transform clamps unsafe editor values', function () {
    assert.deepEqual(normalizePhotoTransform({
        focusX: 2,
        focusY: -1,
        editZoom: 10,
        editOffsetX: -3,
        editOffsetY: 4,
        editRotation: 900,
        flipX: true
    }), {
        focusX: 1,
        focusY: 0,
        zoom: 4,
        offsetX: -1,
        offsetY: 1,
        rotation: 180,
        flipX: true,
        flipY: false
    });
});

test('cover crop moves the detected subject to the requested boundary target', function () {
    var image = { naturalWidth: 1000, naturalHeight: 500 };
    var centred = photoCoverLayout(image, 200, 200, { focusX: 0.75, focusY: 0.5 });
    var rightBoundary = photoCoverLayout(image, 200, 200, { focusX: 0.75, focusY: 0.5 }, { targetX: 0.8, zoom: 1.2 });
    var centredSubjectX = centred.drawX + centred.drawWidth * 0.75;
    var boundarySubjectX = rightBoundary.drawX + rightBoundary.drawWidth * 0.75;
    assert.ok(Math.abs(centredSubjectX) < 0.001);
    assert.ok(boundarySubjectX > centredSubjectX + 30);
});

test('slot-local dragging moves the visible photo without changing its saved subject focus', function () {
    var image = { naturalWidth: 1000, naturalHeight: 500 };
    var photo = { focusX: 0.5, focusY: 0.5 };
    var original = photoCoverLayout(image, 200, 200, photo, { zoom: 1.2 });
    var moved = photoCoverLayout(image, 200, 200, photo, { zoom: 1.2, offsetX: 0.4, offsetY: -0.25 });
    assert.ok(moved.drawX > original.drawX);
    assert.ok(moved.drawY <= original.drawY);
    assert.equal(photo.focusX, 0.5);
    assert.equal(photo.focusY, 0.5);
});

test('slot-local dragging can use a full slot of source overflow', function () {
    var image = { naturalWidth: 3000, naturalHeight: 1000 };
    var photo = { focusX: 0.5, focusY: 0.5 };
    var previousLimit = photoCoverLayout(image, 200, 200, photo, { offsetX: 1 });
    var expandedLimit = photoCoverLayout(image, 200, 200, photo, { offsetX: SLOT_LOCAL_OFFSET_LIMIT });
    var clamped = photoCoverLayout(image, 200, 200, photo, { offsetX: SLOT_LOCAL_OFFSET_LIMIT + 10 });
    assert.ok(expandedLimit.drawX > previousLimit.drawX + 90);
    assert.equal(clamped.drawX, expandedLimit.drawX);
});

test('slot-local zoom supports close-ups beyond boundary auto-crop zoom', function () {
    var image = { naturalWidth: 1000, naturalHeight: 1000 };
    var normal = photoCoverLayout(image, 200, 200, {}, { zoom: 1 });
    var closeUp = photoCoverLayout(image, 200, 200, {}, { zoom: 3 });
    assert.ok(Math.abs(closeUp.drawWidth - normal.drawWidth * 3) < 0.001);
    assert.ok(Math.abs(closeUp.drawHeight - normal.drawHeight * 3) < 0.001);
});

test('slot-local pan reaches the complete crop range after a large zoom', function () {
    var image = { naturalWidth: 1000, naturalHeight: 1000 };
    var centred = photoCoverLayout(image, 200, 200, {}, { zoom: 4 });
    var leftEdge = photoCoverLayout(image, 200, 200, {}, {
        zoom: 4,
        offsetX: -SLOT_LOCAL_OFFSET_LIMIT
    });
    var rightEdge = photoCoverLayout(image, 200, 200, {}, {
        zoom: 4,
        offsetX: SLOT_LOCAL_OFFSET_LIMIT
    });
    assert.equal(leftEdge.drawX, 100 - leftEdge.drawWidth);
    assert.equal(rightEdge.drawX, -100);
    assert.ok(leftEdge.drawX < centred.drawX - 290);
    assert.ok(rightEdge.drawX > centred.drawX + 290);
});

test('thin boundary safe bounds widen panning without uncovering the visible mask', function () {
    var image = { naturalWidth: 1000, naturalHeight: 1000 };
    var regular = photoCoverLayout(image, 200, 200, {}, {
        offsetX: SLOT_LOCAL_OFFSET_LIMIT
    });
    var boundary = photoCoverLayout(image, 200, 200, {}, {
        offsetX: SLOT_LOCAL_OFFSET_LIMIT,
        safeBounds: { x: 0.75, y: 0.2, width: 0.2, height: 0.6 }
    });
    var safeLeft = (0.75 - 0.5) * 200;
    var safeRight = (0.75 + 0.2 - 0.5) * 200;
    assert.equal(regular.drawX, -100);
    assert.ok(boundary.drawX > regular.drawX + 140);
    assert.ok(boundary.drawX <= safeLeft);
    assert.ok(boundary.drawX + boundary.drawWidth >= safeRight);
});

test('malformed boundary bounds stay inside the slot', function () {
    var layout = photoCoverLayout({ naturalWidth: 1000, naturalHeight: 1000 }, 200, 200, {}, {
        offsetX: SLOT_LOCAL_OFFSET_LIMIT,
        offsetY: SLOT_LOCAL_OFFSET_LIMIT,
        safeBounds: { x: 8, y: 8, width: -4, height: -4 }
    });
    assert.equal(layout.drawX, 98);
    assert.equal(layout.drawY, 98);
    assert.ok(layout.drawX + layout.drawWidth >= 100);
    assert.ok(layout.drawY + layout.drawHeight >= 100);
});

test('photo transform writes normalized edit state to a photo', function () {
    var photo = {};
    applyPhotoTransform(photo, {
        focusX: 0.2,
        focusY: 0.8,
        zoom: 1.5,
        offsetX: 0.1,
        offsetY: -0.2,
        rotation: 45,
        flipX: false,
        flipY: true
    });
    assert.equal(photo.editZoom, 1.5);
    assert.equal(photo.editRotation, 45);
    assert.equal(photo.flipY, true);
});

test('rounded rectangle path falls back for older Android WebViews', function () {
    var calls = [];
    var context = {};
    ['moveTo', 'lineTo', 'quadraticCurveTo', 'closePath'].forEach(function (method) {
        context[method] = function () { calls.push([method].concat(Array.from(arguments))); };
    });

    addRoundedRectPath(context, 10, 20, 100, 60, 12);

    assert.deepEqual(calls[0], ['moveTo', 22, 20]);
    assert.equal(calls.filter(function (call) { return call[0] === 'quadraticCurveTo'; }).length, 4);
    assert.deepEqual(calls[calls.length - 1], ['closePath']);
});
