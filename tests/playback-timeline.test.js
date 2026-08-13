import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTimeline } from '../js/playback/PlaybackTimeline.js';

function layout() {
    return [
        { x: 10, y: 10, photoIndex: 0, boundaryDistance: 0 },
        { x: 50, y: 50, photoIndex: 1, boundaryDistance: 10 },
        { x: 90, y: 90, photoIndex: 2, boundaryDistance: 0 }
    ];
}

test('reveal timeline produces matching fade and scale frames', function () {
    var timeline = createTimeline(layout(), 'center-out', {
        canvasWidth: 100,
        canvasHeight: 100,
        stagger: 100,
        transition: 400
    });
    var start = timeline.getFrame(0);
    assert.equal(start.mode, 'reveal');
    assert.deepEqual(Array.from(start.opacities), [0, 0, 0]);
    assert.ok(Array.from(start.scales).every(function (scale) { return Math.abs(scale - 0.86) < 0.001; }));

    var middle = timeline.getFrame(200);
    assert.ok(middle.opacities[1] > 0, 'center cell has started revealing');
    assert.ok(middle.scales[1] > 0.86 && middle.scales[1] <= 1);

    var end = timeline.getFrame(timeline.duration);
    assert.deepEqual(Array.from(end.opacities), [1, 1, 1]);
    assert.deepEqual(Array.from(end.scales), [1, 1, 1]);
});

test('shuffle timeline is deterministic and exposes crossfade assignments', function () {
    var options = { mode: 'shuffle', seed: 42, interval: 1000, transition: 400, cycles: 2 };
    var first = createTimeline(layout(), 'random', options);
    var second = createTimeline(layout(), 'random', options);
    assert.deepEqual(first.cycleStates, second.cycleStates);
    assert.notDeepEqual(first.cycleStates[0], first.cycleStates[1]);

    var start = first.getFrame(0);
    assert.deepEqual(start.previousIndices, [0, 1, 2]);
    assert.equal(start.transitionProgress, 0);

    var transitioned = first.getFrame(400);
    assert.equal(transitioned.transitionProgress, 1);
    assert.deepEqual(transitioned.photoIndices, first.cycleStates[1]);

    var end = first.getFrame(first.duration);
    assert.equal(end.transitionProgress, 1);
    assert.deepEqual(end.photoIndices, first.cycleStates[2]);
});

test('custom playback origin is honoured by reveal timeline', function () {
    var timeline = createTimeline(layout(), 'custom', {
        canvasWidth: 100,
        canvasHeight: 100,
        originX: 90,
        originY: 90,
        stagger: 100,
        transition: 200
    });
    assert.equal(timeline.orderedIndices[0], 2);
});
