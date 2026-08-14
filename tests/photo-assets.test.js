import test from 'node:test';
import assert from 'node:assert/strict';
import { createBitmapLRU } from '../js/image/PhotoAssetManager.js';

test('bitmap LRU closes least recently used decoded images', async function () {
    var closed = [];
    var cache = createBitmapLRU({
        maxEntries: 2,
        maxPixels: 1000000,
        decode: function (blob) {
            return { width: 100, height: 100, id: blob.id, close: function () { closed.push(blob.id); } };
        }
    });
    await cache.get('one', { id: 'one' });
    await cache.get('two', { id: 'two' });
    cache.peek('one');
    await cache.get('three', { id: 'three' });

    assert.equal(cache.peek('two'), null);
    assert.deepEqual(closed, ['two']);
    assert.equal(cache.stats().entries, 2);
    cache.clear();
    assert.deepEqual(closed.sort(), ['one', 'three', 'two'].sort());
});

test('bitmap LRU deduplicates concurrent decode requests', async function () {
    var decodes = 0;
    var cache = createBitmapLRU({
        decode: async function () {
            decodes++;
            return { width: 10, height: 10, close: function () {} };
        }
    });
    var results = await Promise.all([cache.get('same', {}), cache.get('same', {})]);
    assert.equal(decodes, 1);
    assert.equal(results[0], results[1]);
});

test('bitmap LRU closes a decode that completes after its photo is removed', async function () {
    var finish;
    var bitmap = { width: 100, height: 100, closed: false, close: function () { this.closed = true; } };
    var cache = createBitmapLRU({
        maxEntries: 2,
        decode: function () {
            return new Promise(function (resolve) { finish = function () { resolve(bitmap); }; });
        }
    });
    var pending = cache.get('photo:working', {});
    await Promise.resolve();
    cache.removePrefix('photo:');
    finish();
    await assert.rejects(pending, /cancelled/);
    assert.equal(bitmap.closed, true);
    assert.equal(cache.stats().entries, 0);
});

test('asset manager falls back to a DOM image after bitmap decoding fails', async function () {
    var bitmapDecodes = 0, revoked = [];
    var urlAPI = {
        createObjectURL: function () { return 'blob:fallback'; },
        revokeObjectURL: function (url) { revoked.push(url); }
    };
    function FakeImage() {
        this.width = 12;
        this.height = 8;
        this.removeAttribute = function () {};
        Object.defineProperty(this, 'src', {
            set: function (value) { if (value && this.onload) this.onload(); }
        });
    }
    var manager = (await import('../js/image/PhotoAssetManager.js')).createPhotoAssetManager({
        URL: urlAPI,
        Image: FakeImage,
        createImageBitmap: function () {
            bitmapDecodes++;
            return Promise.reject(new Error('bitmap decode failed'));
        }
    });
    var decoded = await manager.getBitmap({
        id: 'fallback-photo',
        assetRevision: 1,
        workingBlob: new Blob(['image'], { type: 'image/png' })
    }, 'working');

    assert.equal(decoded.width, 12);
    assert.equal(bitmapDecodes, 2);
    assert.deepEqual(revoked, []);
    manager.destroy();
    assert.deepEqual(revoked, ['blob:fallback']);
});
