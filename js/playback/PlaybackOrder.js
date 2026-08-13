/**
 * PlaybackOrder — computes the sequence in which layout cells are revealed.
 *
 * Every algorithm returns an array of cell **indices** (into the layout array)
 * ordered from first-to-appear to last-to-appear.
 *
 * All ordering is deterministic: when a seed is provided, the 'random' mode
 * uses the project's SeededRandom so that preview, export and reload all
 * produce the identical sequence.
 */

import { createSeededRandom } from '../layout/SeededRandom.js';

export var PlaybackOrders = {
    CENTER_OUT: 'center-out',
    CENTER_DEEP: 'center-deep',
    OUTSIDE_IN: 'outside-in',
    TOP_LEFT: 'top-left',
    TOP_RIGHT: 'top-right',
    BOTTOM_LEFT: 'bottom-left',
    BOTTOM_RIGHT: 'bottom-right',
    LEFT_RIGHT: 'left-right',
    RIGHT_LEFT: 'right-left',
    TOP_BOTTOM: 'top-bottom',
    BOTTOM_TOP: 'bottom-top',
    SPIRAL: 'spiral',
    RANDOM: 'random',
    CUSTOM: 'custom'
};

export var PlaybackOrderLabels = {
    'center-out': '从中心扩散',
    'center-deep': '从形状深处',
    'outside-in': '从边缘到中心',
    'top-left': '左上角',
    'top-right': '右上角',
    'bottom-left': '左下角',
    'bottom-right': '右下角',
    'left-right': '从左到右',
    'right-left': '从右到左',
    'top-bottom': '从上到下',
    'bottom-top': '从下到上',
    'spiral': '螺旋扩散',
    'random': '随机',
    'custom': '点击选择起点'
};

export var PLAYBACK_ORDER_KEYS = Object.keys(PlaybackOrderLabels);

function num(v, fallback) {
    v = Number(v);
    return Number.isFinite(v) ? v : fallback;
}

/**
 * @param {Array} cells   The layout items (each with x, y, boundaryDistance, …)
 * @param {string} mode   One of PlaybackOrders values.
 * @param {object} options  { canvasWidth, canvasHeight, seed, originX, originY }
 * @returns {number[]}     Ordered array of cell indices.
 */
export function computePlaybackOrder(cells, mode, options) {
    if (!Array.isArray(cells) || !cells.length) return [];
    options = options || {};
    var indices = cells.map(function (_, i) { return i; });

    var canvasW = num(options.canvasWidth, 1);
    var canvasH = num(options.canvasHeight, 1);
    var seed = options.seed || 1;

    switch (mode) {
        /* ---- Distance from a fixed origin ---- */
        case PlaybackOrders.CENTER_OUT:
            return sortByDistance(indices, cells, canvasW / 2, canvasH / 2);

        case PlaybackOrders.TOP_LEFT:
            return sortByDistance(indices, cells, 0, 0);

        case PlaybackOrders.TOP_RIGHT:
            return sortByDistance(indices, cells, canvasW, 0);

        case PlaybackOrders.BOTTOM_LEFT:
            return sortByDistance(indices, cells, 0, canvasH);

        case PlaybackOrders.BOTTOM_RIGHT:
            return sortByDistance(indices, cells, canvasW, canvasH);

        /* ---- By boundary distance (shape-aware) ---- */
        case PlaybackOrders.CENTER_DEEP:
            return sortByBoundaryDistance(indices, cells, true);

        case PlaybackOrders.OUTSIDE_IN:
            return sortByBoundaryDistance(indices, cells, false);

        /* ---- Scan orders ---- */
        case PlaybackOrders.LEFT_RIGHT:
            return indices.sort(function (a, b) {
                return num(cells[a].x, 0) - num(cells[b].x, 0) ||
                    num(cells[a].y, 0) - num(cells[b].y, 0);
            });

        case PlaybackOrders.RIGHT_LEFT:
            return indices.sort(function (a, b) {
                return num(cells[b].x, 0) - num(cells[a].x, 0) ||
                    num(cells[a].y, 0) - num(cells[b].y, 0);
            });

        case PlaybackOrders.TOP_BOTTOM:
            return indices.sort(function (a, b) {
                return num(cells[a].y, 0) - num(cells[b].y, 0) ||
                    num(cells[a].x, 0) - num(cells[b].x, 0);
            });

        case PlaybackOrders.BOTTOM_TOP:
            return indices.sort(function (a, b) {
                return num(cells[b].y, 0) - num(cells[a].y, 0) ||
                    num(cells[a].x, 0) - num(cells[b].x, 0);
            });

        /* ---- Spiral from center outward ---- */
        case PlaybackOrders.SPIRAL:
            return sortBySpiral(indices, cells, canvasW / 2, canvasH / 2);

        /* ---- Deterministic random ---- */
        case PlaybackOrders.RANDOM:
            return shuffleSeeded(indices, seed);

        /* ---- Custom origin (user-clicked point) ---- */
        default:
            if (Number.isFinite(options.originX) && Number.isFinite(options.originY)) {
                return sortByDistance(indices, cells, options.originX, options.originY);
            }
            return sortByDistance(indices, cells, canvasW / 2, canvasH / 2);
    }
}

function sortByDistance(indices, cells, ox, oy) {
    return indices.sort(function (a, b) {
        var da = Math.hypot(num(cells[a].x, 0) - ox, num(cells[a].y, 0) - oy);
        var db = Math.hypot(num(cells[b].x, 0) - ox, num(cells[b].y, 0) - oy);
        return da - db;
    });
}

function sortByBoundaryDistance(indices, cells, innermostFirst) {
    return indices.sort(function (a, b) {
        var da = num(cells[a].boundaryDistance, 0);
        var db = num(cells[b].boundaryDistance, 0);
        return innermostFirst ? db - da : da - db;
    });
}

function sortBySpiral(indices, cells, cx, cy) {
    var scored = indices.map(function (idx) {
        var dx = num(cells[idx].x, 0) - cx;
        var dy = num(cells[idx].y, 0) - cy;
        var radius = Math.hypot(dx, dy);
        var angle = Math.atan2(dy, dx);
        /* Sort primarily by radius, secondarily by angle — creates a spiral feel. */
        return { idx: idx, key: radius * 100 + (angle + Math.PI) * 5 };
    });
    scored.sort(function (a, b) { return a.key - b.key; });
    return scored.map(function (s) { return s.idx; });
}

function shuffleSeeded(indices, seed) {
    var random = createSeededRandom(seed);
    var arr = indices.slice();
    for (var i = arr.length - 1; i > 0; i--) {
        var j = Math.floor(random() * (i + 1));
        var tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
    }
    return arr;
}
