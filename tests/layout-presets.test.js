import test from 'node:test';
import assert from 'node:assert/strict';
import {
    LAYOUT_PRESETS,
    applyLayoutPreset,
    getLayoutPreset,
    layoutPresetMatches
} from '../js/layout/LayoutPresets.js';
import { Shapes } from '../js/shapes.js';

test('layout presets have unique product-facing identifiers', function () {
    var ids = LAYOUT_PRESETS.map(function (preset) { return preset.id; });
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(LAYOUT_PRESETS.length >= 30);
    assert.equal(getLayoutPreset('missing'), null);
    LAYOUT_PRESETS.forEach(function (preset) {
        assert.ok(Shapes[preset.shapeKey], 'missing shape for preset ' + preset.id);
        assert.ok(preset.palette.length >= 2, 'missing palette for preset ' + preset.id);
    });
});

test('applying a layout preset updates the wall in one layout pass', function () {
    var wall = {
        density: 1,
        gap: 0,
        placementMode: 'grid',
        photoShape: 'square',
        smartPlacement: false,
        mixedSizes: false,
        rotationRange: 0,
        shape: null,
        generateCount: 0,
        generateLayout: function () { this.generateCount++; }
    };
    var preset = getLayoutPreset('wedding');
    var shape = { name: '双爱心' };
    applyLayoutPreset(wall, preset, shape);

    assert.equal(wall.shapeKey, 'doubleHeart');
    assert.equal(wall.shape, shape);
    assert.equal(wall.placementMode, 'organic');
    assert.equal(wall.photoShape, 'circle');
    assert.equal(wall.generateCount, 1);
    assert.equal(layoutPresetMatches(wall, 'doubleHeart', preset), true);

    wall.gap = 0;
    assert.equal(layoutPresetMatches(wall, 'doubleHeart', preset), false);
});

test('a preset refuses to apply when its required shape is missing', function () {
    var wall = { generateLayout: function () {} };
    assert.throws(function () {
        applyLayoutPreset(wall, getLayoutPreset('travel'), null);
    }, /Preset shape is unavailable/);
});

test('matrix presets retain their exact column count', function () {
    var preset = getLayoutPreset('matrix-3');
    assert.equal(preset.settings.matrixColumns, 3);
    assert.equal(preset.settings.mixedSizes, false);
    assert.equal(preset.settings.placementMode, 'grid');
});
