import test from 'node:test';
import assert from 'node:assert/strict';
import { createTemplateLibrary, MAX_CUSTOM_TEMPLATES } from '../js/layout/TemplateLibrary.js';

function memoryStorage() {
    var values = new Map();
    return {
        getItem: function (key) { return values.has(key) ? values.get(key) : null; },
        setItem: function (key, value) { values.set(key, String(value)); }
    };
}

test('custom templates persist, validate and delete locally', function () {
    var storage = memoryStorage();
    var library = createTemplateLibrary({ storage: storage });
    var saved = library.save({ id: 'mine', name: ' 我的模板 ', shapeKey: 'china', settings: { density: 5 } });
    assert.equal(saved.name, '我的模板');
    assert.equal(saved.settings.density, 1.5);
    assert.equal(createTemplateLibrary({ storage: storage }).list()[0].id, 'mine');
    assert.equal(library.remove('mine'), true);
    assert.equal(library.list().length, 0);
});

test('custom template library keeps a bounded collection', function () {
    var library = createTemplateLibrary({ storage: memoryStorage() });
    for (var index = 0; index < MAX_CUSTOM_TEMPLATES + 4; index++) {
        library.save({ id: 'template-' + index, name: '模板 ' + index, settings: {} });
    }
    assert.equal(library.list().length, MAX_CUSTOM_TEMPLATES);
});
