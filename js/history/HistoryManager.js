export function createHistoryManager(options) {
    var undoStack = [];
    var redoStack = [];
    var limit = Math.max(1, Number(options.limit) || 30);
    var restoring = false;

    function notify() {
        if (options.onChange) options.onChange({ canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 });
    }
    function record(snapshot) {
        if (restoring) return;
        undoStack.push(snapshot || options.capture());
        if (undoStack.length > limit) undoStack.shift();
        redoStack = [];
        notify();
    }
    function restore(state) {
        restoring = true;
        try { options.restore(state); } finally { restoring = false; }
        notify();
    }
    function undo() {
        if (!undoStack.length) return false;
        var state = undoStack.pop();
        redoStack.push(options.capture());
        restore(state);
        return true;
    }
    function redo() {
        if (!redoStack.length) return false;
        var state = redoStack.pop();
        undoStack.push(options.capture());
        restore(state);
        return true;
    }
    function clear() {
        undoStack = [];
        redoStack = [];
        notify();
    }
    return {
        record: record,
        undo: undo,
        redo: redo,
        clear: clear,
        isRestoring: function () { return restoring; },
        canUndo: function () { return undoStack.length > 0; },
        canRedo: function () { return redoStack.length > 0; }
    };
}
