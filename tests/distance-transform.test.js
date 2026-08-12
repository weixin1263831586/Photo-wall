import test from 'node:test';
import assert from 'node:assert/strict';
import { computeDistanceTransform, sampleDistance } from '../js/mask/DistanceTransform.js';

test('distance transform increases toward the shape interior', function () {
    var width = 7, height = 7;
    var mask = new Uint8Array(width * height);
    for (var y = 1; y < 6; y++) for (var x = 1; x < 6; x++) mask[y * width + x] = 1;
    var distance = computeDistanceTransform(mask, width, height);
    assert.equal(sampleDistance(distance, width, height, 0, 0), 0);
    assert.equal(sampleDistance(distance, width, height, 1, 1), 1);
    assert.equal(sampleDistance(distance, width, height, 3, 3), 3);
});

test('distance transform handles empty masks', function () {
    var distance = computeDistanceTransform(new Uint8Array(16), 4, 4);
    assert.deepEqual(Array.from(distance), new Array(16).fill(0));
});
