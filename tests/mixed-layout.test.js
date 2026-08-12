import test from 'node:test';
import assert from 'node:assert/strict';
import { PhotoWall } from '../js/photowall.js';

function createWall(photoCount, mixedSizes) {
    var width = 800, height = 600, stride = width + 1;
    var integral = new Uint32Array((width + 1) * (height + 1));
    for (var y = 0; y <= height; y++) for (var x = 0; x <= width; x++) integral[y * stride + x] = x * y;
    var wall = Object.create(PhotoWall.prototype);
    Object.assign(wall, {
        shape: {}, cssWidth: width, cssHeight: height, density: 1, placementMode: 'grid',
        mixedSizes: mixedSizes, smartPlacement: true, rotationRange: 0, _slotSequence: 0,
        photos: Array.from({ length: photoCount }, function (_, index) {
            return { id: 'photo-' + index, hue: index % 360, sharpness: 0.2, contrast: 0.3, aspectRatio: 1, focusX: 0.5, focusY: 0.5, featured: index === 2 };
        }),
        maskData: {
            bounds: { x: 0, y: 0, width: width, height: height }, integral: integral,
            distance: new Float32Array(width * height).fill(100), width: width, height: height, insideCount: width * height
        },
        layout: [], generateMask: function () {}, render: function () {}, _animate: function () {}, _refreshOrderCache: function () {}
    });
    wall.generateLayout(false, true);
    return wall;
}

test('39 photos generate mixed sizes and feature the marked photo', function () {
    var wall = createWall(39, true);
    var large = wall.layout.filter(function (cell) { return cell.isLarge; });
    assert.ok(large.length >= 3);
    assert.ok(new Set(wall.layout.map(function (cell) { return Math.round(cell.width); })).size >= 2);
    assert.ok(large.some(function (cell) { return cell.photoId === 'photo-2'; }));
});

test('mixed sizes can be disabled', function () {
    var wall = createWall(39, false);
    assert.equal(wall.layout.filter(function (cell) { return cell.isLarge; }).length, 0);
    assert.equal(new Set(wall.layout.map(function (cell) { return Math.round(cell.width); })).size, 1);
});

test('1000-photo layout remains near its target count', function () {
    var wall = createWall(1000, true);
    assert.ok(Math.abs(wall.layout.length - 1000) / 1000 < 0.08);
});
