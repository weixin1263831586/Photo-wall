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

test('a thin boundary cell grows toward visible mask pixels', function () {
    var wall = createWall(10, false);
    var width = 100, height = 100, stride = width + 1;
    var integral = new Uint32Array((width + 1) * (height + 1));
    for (var y = 1; y <= height; y++) {
        var rowSum = 0;
        for (var x = 1; x <= width; x++) {
            if (x >= 45) rowSum++;
            integral[y * stride + x] = integral[(y - 1) * stride + x] + rowSum;
        }
    }
    var mask = new Uint8Array(width * height);
    for (var my = 0; my < height; my++) for (var mx = 44; mx < width; mx++) mask[my * width + mx] = 1;
    wall.maskData = { width: width, height: height, integral: integral, mask: mask };
    var fitted = wall._fitBoundaryCell(35, 30, 20, 20);
    assert.equal(fitted.isBoundary, true);
    assert.ok(fitted.width > 20 || fitted.height > 20);
    assert.ok(wall._rectMaskArea(fitted.x, fitted.y, fitted.width, fitted.height) > 200);
    assert.ok(fitted.visibleFocusX > 0.5);
});

test('exact grid boundary cells do not grow over their neighbours', function () {
    var wall = createWall(4, false);
    var width = 100, height = 100, stride = width + 1;
    var integral = new Uint32Array((width + 1) * (height + 1));
    var mask = new Uint8Array(width * height);
    for (var y = 1; y <= height; y++) {
        var rowSum = 0;
        for (var x = 1; x <= width; x++) {
            if (x >= 45) { rowSum++; mask[(y - 1) * width + x - 1] = 1; }
            integral[y * stride + x] = integral[(y - 1) * stride + x] + rowSum;
        }
    }
    wall.maskData = {
        width: width, height: height, integral: integral, mask: mask,
        distance: new Float32Array(width * height),
        bounds: { x: 0, y: 0, width: width, height: height }
    };

    var cells = wall._buildMatrixCells(2);
    assert.ok(cells.length >= 2);
    cells.forEach(function (cell) {
        assert.equal(cell.width, 50);
        assert.equal(cell.height, 50);
        assert.equal(cell.baseX % 50, 0);
        assert.equal(cell.baseY % 50, 0);
    });
});

test('export ratios expand from tight bounds in both orientations', function () {
    var wall = Object.create(PhotoWall.prototype);
    wall.getExportBounds = function () { return { x: 20, y: 30, width: 300, height: 500 }; };
    assert.equal(wall.getExportFrame('3:4').width / wall.getExportFrame('3:4').height, 3 / 4);
    assert.equal(wall.getExportFrame('4:3').width / wall.getExportFrame('4:3').height, 4 / 3);
    assert.equal(wall.getExportFrame('9:16').width / wall.getExportFrame('9:16').height, 9 / 16);
    assert.equal(wall.getExportFrame('16:9').width / wall.getExportFrame('16:9').height, 16 / 9);
    assert.equal(wall.getExportFrame('4:3').y + wall.getExportFrame('4:3').height / 2, 280);
});

test('slot-local photo offsets survive a layout snapshot round trip', function () {
    var wall = createWall(8, true);
    wall.layout[0].localOffsetX = 0.65;
    wall.layout[0].localOffsetY = -0.4;
    wall.layout[0].visibleFocusX = 0;
    wall.layout[0].visibleFocusY = 0;
    var snapshot = wall.getLayoutSnapshot();
    wall.layout[0].localOffsetX = 0;
    wall.layout[0].localOffsetY = 0;
    assert.equal(wall.setLayoutSnapshot(snapshot), true);
    assert.equal(wall.layout[0].localOffsetX, 0.65);
    assert.equal(wall.layout[0].localOffsetY, -0.4);
    assert.equal(wall.layout[0].visibleFocusX, 0);
    assert.equal(wall.layout[0].visibleFocusY, 0);
});

test('flow randomization is seeded, changes assignments and preserves every slot', function () {
    function randomized(seed) {
        var wall = createWall(12, false);
        wall._capturePreviousLayer = function () {};
        wall._invalidateRenderCache = function () {};
        var before = wall.getArrangement();
        assert.equal(wall.randomizeAssignments(seed, 0), true);
        var after = wall.getArrangement();
        assert.notDeepEqual(after, before);
        assert.deepEqual(after.slice().sort(), before.slice().sort());
        return after;
    }
    assert.deepEqual(randomized(20260812), randomized(20260812));
});
