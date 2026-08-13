import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPhotoTransform, normalizePhotoTransform, photoCoverLayout } from '../js/image/PhotoTransform.js';

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
