/**
 * PlaybackTimeline — converts an ordered cell sequence into a time-based
 * animation timeline that can drive both the live preview and video export.
 *
 * Two modes:
 *   'reveal'  — cells appear one-by-one, assembling the shape.
 *   'shuffle' — all cells stay visible; photos swap in the selected order.
 */

import { computePlaybackOrder } from './PlaybackOrder.js';
import { createSeededRandom, normalizeSeed } from '../layout/SeededRandom.js';

function photoForCell(cell, options) {
    if (cell && cell.photo) return cell.photo;
    var photos = options && Array.isArray(options.photos) ? options.photos : [];
    var photoIndex = Number(cell && cell.photoIndex);
    return Number.isInteger(photoIndex) ? photos[photoIndex] || null : null;
}

function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
}

function easeOutCubic(value) {
    var t = clamp01(value);
    return 1 - Math.pow(1 - t, 3);
}

function scalesFromOpacities(opacities, style) {
    var scales = new Float32Array(opacities.length);
    for (var i = 0; i < opacities.length; i++) {
        scales[i] = style === 'zoom' || style === 'ken-burns' ? 0.86 + opacities[i] * 0.14 : 1;
    }
    return scales;
}

/**
 * Build a reveal-mode timeline.
 *
 * @param {Array}   layout    The PhotoWall layout array (cells with x, y, …).
 * @param {string}  order     PlaybackOrders key.
 * @param {object}  options   {
 *   canvasWidth, canvasHeight, seed, originX, originY,
 *   stagger   — ms per cell (auto-scaled if omitted),
 *   transition— ms fade-in per cell (default 600),
 *   mode      — 'reveal' | 'shuffle'
 * }
 */
export function createTimeline(layout, order, options) {
    layout = Array.isArray(layout) ? layout : [];
    options = options || {};
    var mode = options.mode || 'reveal';
    var transition = Math.max(80, Number(options.transition) || 600);
    var transitionStyle = ['fade', 'zoom', 'slide', 'ken-burns'].indexOf(options.transitionStyle) >= 0 ?
        options.transitionStyle : 'zoom';
    var cellCount = layout.length;

    var orderedIndices = computePlaybackOrder(layout, order, {
        canvasWidth: options.canvasWidth,
        canvasHeight: options.canvasHeight,
        seed: options.seed,
        originX: options.originX,
        originY: options.originY,
        photos: options.photos
    });

    if (mode === 'shuffle') {
        return createShuffleTimeline(layout, orderedIndices, Object.assign({}, options, { order: order }));
    }

    /* ---- Reveal mode ---- */

    /* Auto-scale stagger so very large layouts don't take too long. */
    var stagger;
    if (options.stagger && Number.isFinite(options.stagger)) {
        stagger = Math.max(20, Number(options.stagger));
    } else {
        /* Target a total reveal of ~6-10 seconds, clamped. */
        var targetReveal = Math.min(10000, Math.max(3000, cellCount * 120));
        stagger = Math.max(30, targetReveal / Math.max(1, cellCount));
    }

    var items = orderedIndices.map(function (cellIndex, sequencePosition) {
        return {
            cellIndex: cellIndex,
            sequencePosition: sequencePosition,
            startTime: sequencePosition * stagger,
            transitionDuration: transition
        };
    });

    var totalDuration = cellCount > 0
        ? items[items.length - 1].startTime + transition
        : 0;

    return {
        mode: 'reveal',
        order: order,
        duration: totalDuration,
        cellCount: cellCount,
        stagger: stagger,
        transition: transition,
        transitionStyle: transitionStyle,
        items: items,
        orderedIndices: orderedIndices,

        /**
         * Returns a Float32Array of per-cell opacity values at the given time.
         * Index i corresponds to layout[i].
         */
        getCellOpacities: function (time) {
            var opacities = new Float32Array(cellCount);
            for (var i = 0; i < items.length; i++) {
                var item = items[i];
                var elapsed = time - item.startTime;
                if (elapsed <= 0) {
                    opacities[item.cellIndex] = 0;
                } else if (elapsed >= item.transitionDuration) {
                    opacities[item.cellIndex] = 1;
                } else {
                    opacities[item.cellIndex] = easeOutCubic(elapsed / item.transitionDuration);
                }
            }
            return opacities;
        },

        /** Scale accompanies the fade, giving each tile a restrained pop-in. */
        getCellScales: function (time) {
            var opacities = this.getCellOpacities(time);
            return scalesFromOpacities(opacities, transitionStyle);
        },

        getFrame: function (time) {
            var opacities = this.getCellOpacities(time);
            var offsetsX = new Float32Array(cellCount);
            var offsetsY = new Float32Array(cellCount);
            var photoZooms = new Float32Array(cellCount);
            for (var i = 0; i < items.length; i++) {
                var item = items[i];
                var progress = opacities[item.cellIndex];
                var cell = layout[item.cellIndex] || {};
                if (transitionStyle === 'ken-burns') {
                    photoZooms[item.cellIndex] = 1 + progress * 0.08;
                    var photo = photoForCell(cell, options);
                    var focusX = photo ? Number(photo.focusX) : 0.5;
                    var focusY = photo ? Number(photo.focusY) : 0.5;
                    if (!Number.isFinite(focusX)) focusX = 0.5;
                    if (!Number.isFinite(focusY)) focusY = 0.5;
                    var panFromX = (0.5 - focusX) * 0.5;
                    var panFromY = (0.5 - focusY) * 0.5;
                    var cellW = Number(cell.width) || 48;
                    var cellH = Number(cell.height) || 48;
                    offsetsX[item.cellIndex] = panFromX * cellW * progress;
                    offsetsY[item.cellIndex] = panFromY * cellH * progress;
                }
                if (transitionStyle !== 'slide') continue;
                var originX = Number.isFinite(Number(options.originX)) ? Number(options.originX) : Number(options.canvasWidth) / 2;
                var originY = Number.isFinite(Number(options.originY)) ? Number(options.originY) : Number(options.canvasHeight) / 2;
                var dx = Number(cell.x) - originX;
                var dy = Number(cell.y) - originY;
                var distance = Math.max(1, Math.hypot(dx, dy));
                var amount = Math.min(32, Math.max(12, Math.min(Number(cell.width) || 48, Number(cell.height) || 48) * 0.28));
                offsetsX[item.cellIndex] += -(dx / distance) * amount * (1 - progress);
                offsetsY[item.cellIndex] += -(dy / distance) * amount * (1 - progress);
            }
            return {
                mode: 'reveal',
                opacities: opacities,
                scales: scalesFromOpacities(opacities, transitionStyle),
                offsetsX: offsetsX,
                offsetsY: offsetsY,
                photoZooms: photoZooms,
                transitionStyle: transitionStyle
            };
        },

        isComplete: function (time) {
            return time >= totalDuration;
        }
    };
}

/** Shuffle one assignment deterministically without mutating the source. */
function shuffleAssignment(assignment, seed) {
    var result = assignment.slice();
    var random = createSeededRandom(seed);
    for (var index = result.length - 1; index > 0; index--) {
        var target = Math.floor(random() * (index + 1));
        var temporary = result[index];
        result[index] = result[target];
        result[target] = temporary;
    }
    if (result.length > 1 && result.every(function (value, index) { return value === assignment[index]; })) {
        result.push(result.shift());
    }
    return result;
}

function createShuffleTimeline(layout, orderedIndices, options) {
    options = options || {};
    var interval = Math.max(500, Number(options.interval) || 3200);
    var transition = Math.min(interval, Math.max(200, Number(options.transition) || 800));
    var cycles = Math.max(1, Number(options.cycles) || 3);
    var cellCount = layout.length;
    var totalDuration = cycles * interval;
    var baseSeed = normalizeSeed(options.seed);
    var requestedStagger = Math.max(0, Number(options.stagger) || 120);
    var maxStagger = cellCount > 1 ? Math.max(0, interval - transition) / (cellCount - 1) : 0;
    var stagger = cellCount > 1 ? Math.min(requestedStagger, maxStagger || requestedStagger) : 0;
    var order = Array.isArray(orderedIndices) && orderedIndices.length === cellCount ?
        orderedIndices.slice() : layout.map(function (_, index) { return index; });
    var positionByCell = new Int32Array(cellCount);
    order.forEach(function (cellIndex, position) {
        if (cellIndex >= 0 && cellIndex < cellCount) positionByCell[cellIndex] = position;
    });

    /* Pre-compute which photo each cell shows at each cycle boundary. When
       the project contains more media than visible cells, cycle through the
       complete library instead of only shuffling the initially assigned
       subset. This is the actual carousel contract: every photo/video gets a
       turn even in a fixed 2×2 or 3×3 layout. */
    var cycleStates = [];
    var currentAssignment = layout.map(function (item) {
        return item.photoIndex;
    });
    var mediaCount = Array.isArray(options.photos) ? options.photos.length : 0;
    var mediaQueue = [];
    if (mediaCount > 0) {
        for (var mediaIndex = 0; mediaIndex < mediaCount; mediaIndex++) mediaQueue.push(mediaIndex);
        mediaQueue = shuffleAssignment(mediaQueue, baseSeed + 7919);
    }

    for (var cycle = 0; cycle <= cycles; cycle++) {
        cycleStates.push(currentAssignment.slice());
        if (cycle < cycles) {
            if (mediaQueue.length) {
                var nextAssignment = currentAssignment.slice();
                for (var position = 0; position < cellCount; position++) {
                    var targetCell = order[position];
                    nextAssignment[targetCell] = mediaQueue[(cycle * cellCount + position) % mediaQueue.length];
                }
                currentAssignment = nextAssignment;
            } else {
                currentAssignment = shuffleAssignment(currentAssignment, baseSeed + cycle + 1);
            }
        }
    }

    function cycleAt(time) {
        time = Math.max(0, Math.min(totalDuration, Number(time) || 0));
        var cycleIndex = Math.floor(time / interval);
        if (cycleIndex >= cycles) cycleIndex = cycles - 1;
        return {
            index: cycleIndex,
            elapsed: time - cycleIndex * interval
        };
    }

    return {
        mode: 'shuffle',
        order: options.order || 'shuffle',
        duration: totalDuration,
        cellCount: cellCount,
        interval: interval,
        transition: transition,
        cycles: cycles,
        mediaCount: mediaCount,
        carousel: mediaQueue.length > 0,
        cycleStates: cycleStates,
        orderedIndices: order,
        stagger: stagger,
        positionByCell: positionByCell,

        /**
         * Returns per-cell opacity (always 1 for shuffle, since all cells
         * remain visible — the transition is a crossfade handled at the
         * renderer level).
         */
        getCellOpacities: function () {
            var opacities = new Float32Array(cellCount);
            for (var i = 0; i < cellCount; i++) opacities[i] = 1;
            return opacities;
        },

        getCellScales: function () {
            var scales = new Float32Array(cellCount);
            for (var i = 0; i < cellCount; i++) scales[i] = 1;
            return scales;
        },

        /**
         * Returns the target assignment plus one crossfade progress per cell.
         * `transitionProgress` is retained for old renderers and represents the
         * earliest cell; new renderers should use `transitionProgresses`.
         */
        getAssignmentAt: function (time) {
            var point = cycleAt(time);
            var previous = cycleStates[point.index];
            var next = cycleStates[point.index + 1] || previous;
            var transitionProgresses = new Float32Array(cellCount);
            for (var cellIndex = 0; cellIndex < cellCount; cellIndex++) {
                var localElapsed = point.elapsed - positionByCell[cellIndex] * stagger;
                transitionProgresses[cellIndex] = localElapsed <= 0 ? 0 :
                    localElapsed >= transition ? 1 : easeOutCubic(localElapsed / transition);
            }
            var firstCell = order.length ? order[0] : 0;
            var progress = transitionProgresses[firstCell] || 0;

            return {
                photoIndices: next,
                previousIndices: previous,
                transitionProgress: progress,
                transitionProgresses: transitionProgresses
            };
        },

        getFrame: function (time) {
            var assignment = this.getAssignmentAt(time);
            return {
                mode: 'shuffle',
                opacities: this.getCellOpacities(time),
                scales: this.getCellScales(time),
                photoIndices: assignment.photoIndices,
                previousIndices: assignment.previousIndices,
                transitionProgress: assignment.transitionProgress,
                transitionProgresses: assignment.transitionProgresses
            };
        },

        isComplete: function (time) {
            return time >= totalDuration;
        }
    };
}
