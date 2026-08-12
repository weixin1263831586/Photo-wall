import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeededRandom, mixSeed, normalizeSeed } from '../js/layout/SeededRandom.js';
import { assignPhotosToCells } from '../js/layout/SmartPlacement.js';

test('seeded random sequences are repeatable and distinct', function () {
    var first = createSeededRandom(42);
    var second = createSeededRandom(42);
    var third = createSeededRandom(43);
    var a = Array.from({ length: 8 }, first);
    assert.deepEqual(a, Array.from({ length: 8 }, second));
    assert.notDeepEqual(a, Array.from({ length: 8 }, third));
    assert.equal(normalizeSeed(0), 1);
    assert.equal(mixSeed(42, 7), mixSeed(42, 7));
});

test('smart placement is reproducible for a fixed seed', function () {
    var photos = Array.from({ length: 12 }, function (_, index) {
        return { id: String(index), hue: index * 29, aspectRatio: 0.6 + index * 0.12,
            contrast: 0.2 + index * 0.03, sharpness: 0.2, focusX: 0.5, focusY: 0.5 };
    });
    var cells = Array.from({ length: 12 }, function (_, index) {
        return { x: 20 + index * 35, y: 50 + index % 3 * 30, width: 42, height: 38,
            boundaryDistance: 18, isLarge: index < 2 };
    });
    var context = { width: 480, height: 180, seed: 78 };
    assert.deepEqual(assignPhotosToCells(photos, cells, context), assignPhotosToCells(photos, cells, context));
});
