import test from 'node:test';
import assert from 'node:assert/strict';
import { getVideoExportPreset, resolveVideoExportDimensions } from '../js/video/VideoExportPresets.js';

test('common video presets resolve to exact platform-safe dimensions', function () {
    assert.deepEqual(resolveVideoExportDimensions('portrait'), { width: 1080, height: 1920, aspectRatio: '9:16', fps: 30 });
    assert.deepEqual(resolveVideoExportDimensions('landscape'), { width: 1920, height: 1080, aspectRatio: '16:9', fps: 30 });
    assert.deepEqual(resolveVideoExportDimensions('square'), { width: 1080, height: 1080, aspectRatio: '1:1', fps: 30 });
});

test('source video preset uses current export frame', function () {
    assert.equal(getVideoExportPreset('missing').id, 'source');
    assert.deepEqual(resolveVideoExportDimensions('source', { width: 777.4, height: 555.6, aspectRatio: 'auto' }), {
        width: 777, height: 556, aspectRatio: 'auto', fps: 30
    });
});
