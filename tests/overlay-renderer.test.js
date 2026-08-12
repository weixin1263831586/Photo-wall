import test from 'node:test';
import assert from 'node:assert/strict';
import { createOverlay, getOverlayAt, normalizeOverlay, normalizeOverlays } from '../js/overlay/OverlayRenderer.js';

test('overlay normalization clamps unsafe project values', function () {
    var overlay = normalizeOverlay({ type: 'text', content: '标题', x: 4, y: -1, fontSize: 3, color: 'bad' });
    assert.equal(overlay.x, 1);
    assert.equal(overlay.y, 0);
    assert.equal(overlay.fontSize, 0.22);
    assert.equal(overlay.color, '#ffffff');
    assert.equal(normalizeOverlays(null).length, 0);
});

test('text overlays can be hit-tested for direct manipulation', function () {
    var context = {
        save: function () {}, restore: function () {},
        measureText: function (value) { return { width: value.length * 30 }; }
    };
    var overlay = createOverlay('text', 'title', '照片墙', { x: 0.5, y: 0.5, fontSize: 0.1 });
    assert.equal(getOverlayAt(context, [overlay], 500, 400, 1000, 800), 'title');
    assert.equal(getOverlayAt(context, [overlay], 10, 10, 1000, 800), null);
});
