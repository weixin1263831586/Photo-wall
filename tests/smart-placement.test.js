import test from 'node:test';
import assert from 'node:assert/strict';
import { assignPhotosToCells } from '../js/layout/SmartPlacement.js';

function photo(overrides) {
    return Object.assign({ hue: 0, aspectRatio: 1, sharpness: 0.2, contrast: 0.3, focusX: 0.5, focusY: 0.5 }, overrides);
}

test('featured portrait wins a large portrait slot', function () {
    var photos = [photo({ id: 'wide', aspectRatio: 2 }), photo({ id: 'hero', aspectRatio: 0.5, featured: true })];
    var cells = [
        { x: 50, y: 100, width: 100, height: 200, isLarge: true, boundaryDistance: 60 },
        { x: 220, y: 100, width: 200, height: 100, isLarge: false, boundaryDistance: 20 }
    ];
    var assignment = assignPhotosToCells(photos, cells, { width: 320, height: 240 });
    assert.equal(photos[assignment[0]].id, 'hero');
    assert.equal(photos[assignment[1]].id, 'wide');
});

test('matching aspect ratios dominate the placement ranking', function () {
    /* The old placementScore() export was removed; verify the same intent
       through the production assignment: a wide photo must land in the wide
       cell and a tall photo in the tall cell. */
    var photos = [photo({ id: 'wide', aspectRatio: 2 }), photo({ id: 'tall', aspectRatio: 0.5 })];
    var cells = [
        { x: 50, y: 50, width: 200, height: 100, boundaryDistance: 20 },
        { x: 50, y: 200, width: 100, height: 200, boundaryDistance: 20 }
    ];
    var assignment = assignPhotosToCells(photos, cells, { width: 300, height: 300 });
    assert.equal(photos[assignment[0]].id, 'wide');
    assert.equal(photos[assignment[1]].id, 'tall');
});

test('assignment distributes unique photos before nearby reuse', function () {
    var photos = [photo({ id: 'a' }), photo({ id: 'b', hue: 30 }), photo({ id: 'c', hue: 60 })];
    var cells = Array.from({ length: 3 }, function (_, index) {
        return { x: 40 + index * 45, y: 50, width: 40, height: 40, boundaryDistance: 10 };
    });
    var assignment = assignPhotosToCells(photos, cells, { width: 200, height: 100 });
    assert.equal(new Set(assignment).size, 3);
});

test('a featured photo is not duplicated while unused photos remain', function () {
    var photos = Array.from({ length: 8 }, function (_, index) {
        return photo({ id: String(index), featured: index === 0, sharpness: index === 0 ? 0.8 : 0.1 });
    });
    var cells = Array.from({ length: 8 }, function (_, index) {
        return { x: index * 60, y: 60, width: 55, height: 55, isLarge: index < 3, boundaryDistance: 25 };
    });
    var assignment = assignPhotosToCells(photos, cells, { width: 500, height: 120 });
    assert.equal(new Set(assignment).size, photos.length);
    assert.equal(assignment.filter(function (index) { return index === 0; }).length, 1);
});

test('unique photos take the largest visible contour slots before repeats', function () {
    var photos = [photo({ id: 'a' }), photo({ id: 'b', hue: 120 })];
    var cells = [
        { x: 10, y: 10, width: 20, height: 20, boundaryDistance: 0, maskCoverage: 0.1, visibleArea: 40 },
        { x: 50, y: 10, width: 40, height: 40, boundaryDistance: 0, maskCoverage: 0.8, visibleArea: 1280 },
        { x: 90, y: 10, width: 35, height: 35, boundaryDistance: 0, maskCoverage: 0.7, visibleArea: 857.5 }
    ];
    var assignment = assignPhotosToCells(photos, cells, { width: 100, height: 40, seed: 7 });

    assert.equal(new Set([assignment[1], assignment[2]]).size, 2);
    assert.ok(assignment[0] === assignment[1] || assignment[0] === assignment[2]);
});
