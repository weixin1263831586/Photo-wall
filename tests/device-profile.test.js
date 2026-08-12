import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeviceProfile, getImportDimension } from '../js/platform/DeviceProfile.js';

test('desktop profile keeps higher concurrency and history depth', function () {
    var profile = createDeviceProfile({ viewportWidth: 1440, deviceMemory: 16, hardwareConcurrency: 16 });
    assert.equal(profile.mobile, false);
    assert.equal(profile.photoLoadConcurrency, 6);
    assert.equal(profile.analysisWorkers, 4);
    assert.equal(profile.maxWorkingBitmaps, 180);
    assert.equal(profile.maxOriginalBitmaps, 8);
    assert.equal(profile.historyLimit, 30);
    assert.equal(getImportDimension(profile, 50), 1600);
});

test('low-memory mobile profile limits decode and canvas pressure', function () {
    var profile = createDeviceProfile({ viewportWidth: 390, coarsePointer: true, deviceMemory: 4, hardwareConcurrency: 8 });
    assert.equal(profile.mobile, true);
    assert.equal(profile.photoLoadConcurrency, 2);
    assert.equal(profile.analysisWorkers, 1);
    assert.equal(profile.maxEditorDpr, 1.5);
    assert.equal(profile.thumbnailDimension, 192);
    assert.equal(profile.maxWorkingBitmaps, 32);
    assert.equal(profile.maxOriginalBitmaps, 2);
    assert.equal(profile.historyLimit, 12);
    assert.equal(getImportDimension(profile, 80), 800);
    assert.equal(getImportDimension(profile, 350), 480);
});

test('wide touch-enabled Windows devices keep the desktop profile', function () {
    var profile = createDeviceProfile({ viewportWidth: 1440, coarsePointer: true, deviceMemory: 16, hardwareConcurrency: 12 });
    assert.equal(profile.mobile, false);
    assert.equal(profile.historyLimit, 30);
});
