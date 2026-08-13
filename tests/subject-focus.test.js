import test from 'node:test';
import assert from 'node:assert/strict';
import { dominantFaceFocus, refineSubjectFocus } from '../js/image/SubjectFocus.js';

test('dominant face becomes the crop focus', function () {
    var focus = dominantFaceFocus([
        { boundingBox: { x: 10, y: 10, width: 10, height: 10 } },
        { boundingBox: { x: 120, y: 30, width: 60, height: 80 } }
    ], 200, 120);
    assert.equal(focus.focusX, 0.75);
    assert.equal(focus.focusY, 70 / 120);
    assert.equal(focus.focusSource, 'face');
});

test('subject focus safely falls back to saliency', async function () {
    var result = await refineSubjectFocus({ width: 100, height: 100 }, { focusX: 0.4, focusY: 0.6 }, null);
    assert.equal(result.focusX, 0.4);
    assert.equal(result.focusY, 0.6);
    assert.equal(result.focusSource, 'saliency');
});
