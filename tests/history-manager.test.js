import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistoryManager } from '../js/history/HistoryManager.js';

test('history manager restores undo and redo states', function () {
    var value = 1;
    var history = createHistoryManager({
        capture: function () { return value; },
        restore: function (state) { value = state; },
        limit: 3
    });
    history.record();
    value = 2;
    assert.equal(history.undo(), true);
    assert.equal(value, 1);
    assert.equal(history.redo(), true);
    assert.equal(value, 2);
});

test('history manager enforces its configured limit', function () {
    var value = 0;
    var history = createHistoryManager({ capture: function () { return value; }, restore: function (state) { value = state; }, limit: 2 });
    history.record(); value = 1;
    history.record(); value = 2;
    history.record(); value = 3;
    history.undo(); history.undo();
    assert.equal(value, 1);
    assert.equal(history.undo(), false);
});

test('history manager exposes retained states for resource cleanup', function () {
    var value = 0;
    var history = createHistoryManager({ capture: function () { return value; }, restore: function (state) { value = state; }, limit: 2 });
    history.record(); value = 1;
    history.record(); value = 2;
    history.undo();
    var retained = [];
    history.visitStates(function (state) { retained.push(state); });
    assert.deepEqual(retained.sort(), [0, 2]);
});
