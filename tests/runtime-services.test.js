import test from 'node:test';
import assert from 'node:assert/strict';
import { createCrashReport, CRASH_STORAGE_KEY, MAX_CRASH_REPORTS, storeCrashReport } from '../js/platform/RuntimeServices.js';

test('local crash reports are bounded and exclude project/photo data', function () {
    var value = '';
    var storage = {
        getItem: function () { return value || null; },
        setItem: function (key, next) { assert.equal(key, CRASH_STORAGE_KEY); value = next; }
    };
    for (var index = 0; index < MAX_CRASH_REPORTS + 3; index++) {
        storeCrashReport(createCrashReport(new Error('failure-' + index), 'test'), storage);
    }
    var reports = JSON.parse(value);
    assert.equal(reports.length, MAX_CRASH_REPORTS);
    assert.equal(reports[0].message, 'failure-12');
    assert.equal(Object.prototype.hasOwnProperty.call(reports[0], 'photos'), false);
});
