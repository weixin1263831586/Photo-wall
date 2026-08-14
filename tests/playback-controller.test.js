import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlaybackController } from '../js/controllers/PlaybackController.js';

test('playback controller gives preview and export identical timelines', function () {
    var app = {
        wall: {
            layout: [
                { x: 0, y: 0, photoIndex: 0 },
                { x: 50, y: 50, photoIndex: 1 }
            ],
            cssWidth: 100, cssHeight: 100, layoutSeed: 42
        },
        photos: [{ featured: false }, { featured: true }],
        playbackOrder: 'featured-first',
        playbackMode: 'reveal',
        playbackTransition: 'slide',
        flowTiming: function () { return { stagger: 100, interval: 1000, transition: 400 }; },
        getPlaybackOrigin: function () { return null; }
    };
    var controller = createPlaybackController(app);
    var preview = controller.createTimeline('reveal');
    var exported = controller.createTimeline('reveal');
    assert.deepEqual(preview.orderedIndices, exported.orderedIndices);
    assert.deepEqual(Array.from(preview.getFrame(200).offsetsX), Array.from(exported.getFrame(200).offsetsX));
});
