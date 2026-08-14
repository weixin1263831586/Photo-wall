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

test('fade, slide and Ken Burns frames expose distinct motion data', function () {
    var base = { canvasWidth: 100, canvasHeight: 100, stagger: 100, transition: 400 };
    var fade = createTimeline(layout(), 'center-out', Object.assign({}, base, { transitionStyle: 'fade' })).getFrame(200);
    assert.ok(Array.from(fade.scales).every(function (scale) { return scale === 1; }));

    var slide = createTimeline(layout(), 'center-out', Object.assign({}, base, { transitionStyle: 'slide' })).getFrame(50);
    assert.ok(Array.from(slide.offsetsX).some(function (offset) { return offset !== 0; }) ||
        Array.from(slide.offsetsY).some(function (offset) { return offset !== 0; }));

    var kenBurnsTimeline = createTimeline(layout(), 'center-out', Object.assign({}, base, { transitionStyle: 'ken-burns' }));
    var kenBurns = kenBurnsTimeline.getFrame(200);
    assert.ok(Array.from(kenBurns.photoZooms).some(function (zoom) { return zoom > 1; }));
});

test('timeline survives project JSON roundtrip deterministically', function () {
    var project = JSON.parse(JSON.stringify({
        order: 'capture-asc', seed: 73,
        photos: [
            { captureTime: '2024-02-01T00:00:00.000Z' },
            { captureTime: '2023-02-01T00:00:00.000Z' },
            { captureTime: '2025-02-01T00:00:00.000Z' }
        ]
    }));
    var options = { canvasWidth: 100, canvasHeight: 100, seed: project.seed, photos: project.photos, transitionStyle: 'slide' };
    var preview = createTimeline(layout(), project.order, options);
    var exported = createTimeline(layout(), project.order, JSON.parse(JSON.stringify(options)));
    assert.deepEqual(preview.orderedIndices, exported.orderedIndices);
    assert.deepEqual(Array.from(preview.getFrame(500).opacities), Array.from(exported.getFrame(500).opacities));
    assert.deepEqual(Array.from(preview.getFrame(500).offsetsX), Array.from(exported.getFrame(500).offsetsX));
});
