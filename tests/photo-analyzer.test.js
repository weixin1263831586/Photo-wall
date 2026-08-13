import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePixels } from '../js/image/PhotoAnalyzer.js';

test('analyzePixels extracts colour and aspect ratio', function () {
    var data = new Uint8ClampedArray([
        255, 0, 0, 255, 255, 0, 0, 255,
        255, 0, 0, 255, 255, 0, 0, 255
    ]);
    var result = analyzePixels(data, 2, 2, 1600, 900);
    assert.equal(result.r, 255);
    assert.equal(result.g, 0);
    assert.equal(result.hue, 0);
    assert.equal(result.aspectRatio, 1600 / 900);
    assert.ok(result.focusX >= 0 && result.focusX <= 1);
});

test('analyzePixels locates a high-contrast subject', function () {
    var width = 5, height = 5;
    var data = new Uint8ClampedArray(width * height * 4);
    for (var i = 0; i < width * height; i++) {
        var value = i % width === 4 ? 255 : 20;
        data[i * 4] = value;
        data[i * 4 + 1] = value;
        data[i * 4 + 2] = value;
        data[i * 4 + 3] = 255;
    }
    var result = analyzePixels(data, width, height, width, height);
    assert.ok(result.focusX > 0.55);
    assert.ok(result.contrast > 0.5);
});

test('analyzePixels uses a connected skin-tone subject away from the centre', function () {
    var width = 20, height = 20;
    var data = new Uint8ClampedArray(width * height * 4);
    for (var y = 0; y < height; y++) for (var x = 0; x < width; x++) {
        var index = (y * width + x) * 4;
        var subject = x >= 14 && x <= 18 && y >= 4 && y <= 11;
        data[index] = subject ? 205 : 35;
        data[index + 1] = subject ? 145 : 45;
        data[index + 2] = subject ? 112 : 55;
        data[index + 3] = 255;
    }
    var result = analyzePixels(data, width, height, width, height);
    assert.equal(result.focusSource, 'subject');
    assert.ok(result.focusX > 0.68);
    assert.ok(result.focusY < 0.55);
});
