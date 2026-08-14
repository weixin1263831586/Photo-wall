import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    computePlaybackOrder,
    PlaybackOrders,
    PlaybackOrderLabels,
    PLAYBACK_ORDER_KEYS
} from '../js/playback/PlaybackOrder.js';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function makeCells(count, width, height) {
    var cells = [];
    var cols = Math.ceil(Math.sqrt(count));
    var cw = width / cols, ch = height / cols;
    for (var i = 0; i < count; i++) {
        var row = Math.floor(i / cols);
        var col = i % cols;
        cells.push({
            x: col * cw + cw / 2,
            y: row * ch + ch / 2,
            width: cw,
            height: ch,
            boundaryDistance: Math.min(col * cw, (cols - 1 - col) * cw, row * ch, (cols - 1 - row) * ch)
        });
    }
    return cells;
}

/* ------------------------------------------------------------------ */
/* Basic properties                                                    */
/* ------------------------------------------------------------------ */

test('empty cells returns empty array', function () {
    assert.deepEqual(computePlaybackOrder([], PlaybackOrders.CENTER_OUT), []);
});

test('returns all indices exactly once', function () {
    var cells = makeCells(9, 300, 300);
    var order = computePlaybackOrder(cells, PlaybackOrders.CENTER_OUT, { canvasWidth: 300, canvasHeight: 300 });
    assert.equal(order.length, 9);
    var seen = new Set(order);
    assert.equal(seen.size, 9, 'no duplicates');
});

test('single cell returns [0]', function () {
    var order = computePlaybackOrder([{ x: 50, y: 50 }], PlaybackOrders.CENTER_OUT, { canvasWidth: 100, canvasHeight: 100 });
    assert.deepEqual(order, [0]);
});

/* ------------------------------------------------------------------ */
/* Center-out ordering                                                 */
/* ------------------------------------------------------------------ */

test('center-out: center cell appears first', function () {
    var cells = [
        { x: 0, y: 0, boundaryDistance: 0 },     // top-left
        { x: 50, y: 50, boundaryDistance: 25 },   // center
        { x: 100, y: 100, boundaryDistance: 0 }   // bottom-right
    ];
    var order = computePlaybackOrder(cells, PlaybackOrders.CENTER_OUT, { canvasWidth: 100, canvasHeight: 100 });
    assert.equal(order[0], 1, 'center cell should be first');
});

/* ------------------------------------------------------------------ */
/* Corner origins                                                      */
/* ------------------------------------------------------------------ */

test('top-left: nearest cell to (0,0) appears first', function () {
    var cells = [
        { x: 90, y: 90, boundaryDistance: 5 },
        { x: 10, y: 10, boundaryDistance: 5 },
        { x: 50, y: 50, boundaryDistance: 20 }
    ];
    var order = computePlaybackOrder(cells, PlaybackOrders.TOP_LEFT, { canvasWidth: 100, canvasHeight: 100 });
    assert.equal(order[0], 1, 'cell nearest top-left should be first');
});

test('bottom-right: nearest cell to (W,H) appears first', function () {
    var cells = [
        { x: 10, y: 10, boundaryDistance: 5 },
        { x: 90, y: 90, boundaryDistance: 5 },
        { x: 50, y: 50, boundaryDistance: 20 }
    ];
    var order = computePlaybackOrder(cells, PlaybackOrders.BOTTOM_RIGHT, { canvasWidth: 100, canvasHeight: 100 });
    assert.equal(order[0], 1, 'cell nearest bottom-right should be first');
});

/* ------------------------------------------------------------------ */
/* Boundary-distance-based ordering                                    */
/* ------------------------------------------------------------------ */

test('center-deep: innermost cells (highest boundaryDistance) first', function () {
    var cells = [
        { x: 50, y: 50, boundaryDistance: 30 },  // innermost
        { x: 10, y: 10, boundaryDistance: 5 },   // edge
        { x: 50, y: 20, boundaryDistance: 15 }   // middle
    ];
    var order = computePlaybackOrder(cells, PlaybackOrders.CENTER_DEEP);
    assert.equal(order[0], 0, 'innermost cell first');
    assert.equal(order[order.length - 1], 1, 'edge cell last');
});

test('outside-in: outermost cells (lowest boundaryDistance) first', function () {
    var cells = [
        { x: 50, y: 50, boundaryDistance: 30 },
        { x: 10, y: 10, boundaryDistance: 5 },
        { x: 50, y: 20, boundaryDistance: 15 }
    ];
    var order = computePlaybackOrder(cells, PlaybackOrders.OUTSIDE_IN);
    assert.equal(order[0], 1, 'outermost cell first');
});

/* ------------------------------------------------------------------ */
/* Scan orders                                                         */
/* ------------------------------------------------------------------ */

test('left-right: sorts by x then y', function () {
    var cells = [
        { x: 80, y: 10, boundaryDistance: 0 },
        { x: 20, y: 50, boundaryDistance: 0 },
        { x: 20, y: 10, boundaryDistance: 0 }
    ];
    var order = computePlaybackOrder(cells, PlaybackOrders.LEFT_RIGHT);
    assert.deepEqual(order, [2, 1, 0]);
});

test('top-bottom: sorts by y then x', function () {
    var cells = [
        { x: 50, y: 80, boundaryDistance: 0 },
        { x: 80, y: 10, boundaryDistance: 0 },
        { x: 20, y: 10, boundaryDistance: 0 }
    ];
    var order = computePlaybackOrder(cells, PlaybackOrders.TOP_BOTTOM);
    assert.deepEqual(order, [2, 1, 0]);
});

/* ------------------------------------------------------------------ */
/* Spiral                                                              */
/* ------------------------------------------------------------------ */

test('spiral: center cell appears early', function () {
    var cells = makeCells(25, 500, 500);
    var order = computePlaybackOrder(cells, PlaybackOrders.SPIRAL, { canvasWidth: 500, canvasHeight: 500 });
    assert.equal(order.length, 25);
    /* The very center cell (index 12 in a 5x5 grid) should be in the first few. */
    assert.ok(order.indexOf(12) < 5, 'center cell should appear early in spiral');
});

/* ------------------------------------------------------------------ */
/* Random (deterministic)                                              */
/* ------------------------------------------------------------------ */

test('random: same seed produces same order', function () {
    var cells = makeCells(10, 200, 200);
    var order1 = computePlaybackOrder(cells, PlaybackOrders.RANDOM, { seed: 42 });
    var order2 = computePlaybackOrder(cells, PlaybackOrders.RANDOM, { seed: 42 });
    assert.deepEqual(order1, order2);
});

test('random: different seeds usually produce different orders', function () {
    var cells = makeCells(20, 200, 200);
    var order1 = computePlaybackOrder(cells, PlaybackOrders.RANDOM, { seed: 1 });
    var order2 = computePlaybackOrder(cells, PlaybackOrders.RANDOM, { seed: 999 });
    assert.notDeepEqual(order1, order2);
});

test('capture time orders are stable and keep missing dates last', function () {
    var cells = [
        { x: 0, y: 0, photoIndex: 0 },
        { x: 10, y: 0, photoIndex: 1 },
        { x: 20, y: 0, photoIndex: 2 }
    ];
    var photos = [
        { captureTime: '2024-03-01T00:00:00.000Z' },
        { captureTime: null },
        { captureTime: '2022-03-01T00:00:00.000Z' }
    ];
    assert.deepEqual(computePlaybackOrder(cells, PlaybackOrders.CAPTURE_ASC, { photos: photos }), [2, 0, 1]);
    assert.deepEqual(computePlaybackOrder(cells, PlaybackOrders.CAPTURE_DESC, { photos: photos }), [0, 2, 1]);
});

test('featured photos play before regular photos', function () {
    var cells = [
        { x: 50, y: 50, photo: { featured: false } },
        { x: 90, y: 90, photo: { featured: true } },
        { x: 10, y: 10, photo: { featured: true } }
    ];
    var order = computePlaybackOrder(cells, PlaybackOrders.FEATURED_FIRST, { canvasWidth: 100, canvasHeight: 100 });
    assert.deepEqual(order.slice(0, 2).sort(), [1, 2]);
    assert.equal(order[2], 0);
});

/* ------------------------------------------------------------------ */
/* Custom origin                                                       */
/* ------------------------------------------------------------------ */

test('custom origin: cells nearest to clicked point appear first', function () {
    var cells = [
        { x: 10, y: 10, boundaryDistance: 0 },
        { x: 90, y: 90, boundaryDistance: 0 },
        { x: 50, y: 50, boundaryDistance: 10 }
    ];
    var order = computePlaybackOrder(cells, 'custom', {
        canvasWidth: 100, canvasHeight: 100,
        originX: 10, originY: 10
    });
    assert.equal(order[0], 0, 'cell nearest custom origin should be first');
});

/* ------------------------------------------------------------------ */
/* Labels / keys                                                       */
/* ------------------------------------------------------------------ */

test('PlaybackOrderLabels has all order keys', function () {
    PLAYBACK_ORDER_KEYS.forEach(function (key) {
        assert.ok(typeof PlaybackOrderLabels[key] === 'string' && PlaybackOrderLabels[key].length > 0,
            key + ' should have a label');
    });
    assert.ok(PLAYBACK_ORDER_KEYS.length >= 10, 'should have at least 10 order modes');
});
