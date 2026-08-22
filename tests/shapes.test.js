import test from 'node:test';
import assert from 'node:assert/strict';
import { Shapes } from '../js/shapes.js';

test('built-in outline catalog is broad and structurally valid', function () {
    var keys = Shapes.keys();
    assert.ok(keys.length >= 36);
    assert.equal(new Set(keys).size, keys.length);
    keys.forEach(function (key) {
        var shape = Shapes[key];
        assert.ok(shape.name && shape.name.length <= 12, 'invalid name for ' + key);
        assert.ok(shape.viewBox.width > 0 && shape.viewBox.height > 0, 'invalid viewBox for ' + key);
        assert.ok(Array.isArray(shape.paths) && shape.paths.length > 0, 'missing paths for ' + key);
        shape.paths.forEach(function (path) {
            assert.match(path, /^M/i, 'path must start with M for ' + key);
            assert.ok(path.length >= 12, 'path is too short for ' + key);
        });
    });
});
