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
    assert.equal(focus.faceCount, 2);
    assert.equal(focus.faceBoxes.length, 2);
    assert.ok(focus.faceGroupBox.x < focus.faceBox.x);
    assert.ok(focus.faceGroupBox.width > focus.faceBox.width);
    assert.ok(focus.subjectConfidence >= 0.68);
});

test('face boxes are clamped to the source image bounds', function () {
    var focus = dominantFaceFocus([
        { boundingBox: { x: 180, y: 90, width: 60, height: 50 } }
    ], 200, 120);
    assert.ok(focus);
    assert.equal(focus.faceBox.x, 0.9);
    assert.equal(focus.faceBox.y, 0.75);
    assert.ok(Math.abs(focus.faceBox.width - 0.1) < 1e-12);
    assert.ok(Math.abs(focus.faceBox.height - 0.25) < 1e-12);
    assert.ok(focus.faceBox.x + focus.faceBox.width <= 1 + Number.EPSILON);
    assert.ok(focus.faceBox.y + focus.faceBox.height <= 1 + Number.EPSILON);
    assert.ok(focus.personBox.x + focus.personBox.width <= 1 + Number.EPSILON);
    assert.ok(focus.personBox.y + focus.personBox.height <= 1 + Number.EPSILON);
});

test('fully out-of-frame face boxes are ignored', function () {
    var focus = dominantFaceFocus([
        { boundingBox: { x: 250, y: 150, width: 40, height: 40 } }
    ], 200, 120);
    assert.equal(focus, null);
});

test('subject focus safely falls back to saliency', async function () {
    var result = await refineSubjectFocus({ width: 100, height: 100 }, { focusX: 0.4, focusY: 0.6 }, null);
    assert.equal(result.focusX, 0.4);
    assert.equal(result.focusY, 0.6);
    assert.equal(result.focusSource, 'saliency');
});
