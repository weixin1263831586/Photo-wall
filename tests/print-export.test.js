import test from 'node:test';
import assert from 'node:assert/strict';
import {
    assessPrintResolution,
    getPrintPreset,
    millimetresToPixels,
    printPixelDimensions
} from '../js/export/PrintExport.js';

test('A4 at 300 DPI uses standard professional print dimensions', function () {
    var preset = getPrintPreset('a4-portrait');
    var dimensions = printPixelDimensions(preset, 300, 0);
    assert.equal(dimensions.width, 2480);
    assert.equal(dimensions.height, 3508);
    assert.equal(millimetresToPixels(25.4, 300), 300);
});

test('print dimensions include bleed on every edge', function () {
    var preset = getPrintPreset('a4-portrait');
    var noBleed = printPixelDimensions(preset, 300, 0);
    var bleed = printPixelDimensions(preset, 300, 3);
    assert.ok(bleed.width > noBleed.width);
    assert.ok(bleed.height > noBleed.height);
});

test('print resolution assessment labels 300 DPI as professional', function () {
    var result = assessPrintResolution(2480, 3508, getPrintPreset('a4-portrait'));
    assert.ok(result.dpi >= 299);
    assert.equal(result.quality, 'excellent');
});
