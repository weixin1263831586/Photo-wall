import { createTimeline } from '../playback/PlaybackTimeline.js';

/** Centralises timeline construction so preview, live playback and export cannot drift. */
export function createPlaybackController(app) {
    return {
        createTimeline: function (mode, overrides) {
            overrides = overrides || {};
            var timing = app.flowTiming();
            var origin = app.getPlaybackOrigin();
            return createTimeline(app.wall.layout, app.playbackOrder, Object.assign({
                mode: mode || app.playbackMode,
                canvasWidth: app.wall.cssWidth,
                canvasHeight: app.wall.cssHeight,
                seed: app.wall.layoutSeed,
                stagger: timing.stagger,
                interval: timing.interval,
                transition: timing.transition,
                transitionStyle: app.playbackTransition,
                photos: app.photos,
                cycles: mode === 'shuffle' ? 1 : 1,
                originX: origin ? origin.x : undefined,
                originY: origin ? origin.y : undefined
            }, overrides));
        }
    };
}
