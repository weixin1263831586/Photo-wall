import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPhotoTransform, normalizePhotoTransform } from '../js/image/PhotoTransform.js';

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
