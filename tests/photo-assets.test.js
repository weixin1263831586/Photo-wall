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

function blankFrameDocument(sampleLuminance) {
    var reads = 0;
    var seeks = [];
    var video = {
        videoWidth: 640,
        videoHeight: 360,
        duration: 10,
        currentTime: 0,
        muted: true,
        preload: '',
        playsInline: true,
        pause: function () {},
        removeAttribute: function () {},
        load: function () {
            setTimeout(function () {
                if (video.onloadedmetadata) video.onloadedmetadata();
                if (video.onloadeddata) video.onloadeddata();
            }, 0);
        }
    };
    Object.defineProperty(video, 'currentTime', {
        get: function () { return this._time || 0; },
        set: function (value) {
            this._time = value;
            seeks.push(value);
            var handler = this.onseeked;
            if (handler) setTimeout(handler, 0);
        }
    });
    var drawSizes = [];
    function makeContext(canvas) {
        return {
            imageSmoothingEnabled: true,
            imageSmoothingQuality: 'high',
            fillStyle: '',
            createLinearGradient: function () {
                return { addColorStop: function () {} };
            },
            fillRect: function () {},
            beginPath: function () {},
            moveTo: function () {},
            lineTo: function () {},
            closePath: function () {},
            fill: function () {},
            fillText: function () {},
            font: '',
            textAlign: '',
            drawImage: function (image, x, y, width, height) {
                drawSizes.push(width + 'x' + height);
            },
            getImageData: function (x, y, width, height) {
                reads++;
                var luminance = sampleLuminance(reads);
                var data = new Uint8ClampedArray(width * height * 4);
                for (var i = 0; i < data.length; i += 4) {
                    data[i] = luminance;
                    data[i + 1] = luminance;
                    data[i + 2] = luminance;
                    data[i + 3] = 255;
                }
                return { data: data };
            }
        };
    }
    var document = {
        createElement: function (tag) {
            if (tag === 'video') return video;
            var canvas = { width: 0, height: 0 };
            canvas.getContext = function () { return makeContext(canvas); };
            canvas.toBlob = function (callback, mime) {
                setTimeout(function () {
                    callback(new Blob(['frame'], { type: mime }));
                }, 0);
            };
            return canvas;
        }
    };
    return { document: document, video: video, seeks: seeks, drawSizes: drawSizes };
}

test('video import re-seeks to the middle when the captured poster frame is blank', async function () {
    var env = blankFrameDocument(function (read) { return read === 1 ? 0 : 200; });
    var manager = (await import('../js/image/PhotoAssetManager.js')).createPhotoAssetManager({
        document: env.document,
        URL: {
            createObjectURL: function () { return 'blob:video'; },
            revokeObjectURL: function () {}
        }
    });
    var layers = await manager.createVideoLayers(new Blob(['mp4'], { type: 'video/mp4' }));

    assert.equal(layers.mediaType, 'video');
    assert.equal(layers.duration, 10);
    assert.equal(layers.posterFallback, false);
    assert.equal(layers.workingWidth, 640);
    assert.equal(layers.workingBlob.type, 'image/jpeg');
    /* loadVideoFrame seeks to 1s, the blank-frame recovery to the middle. */
    assert.deepEqual(env.seeks, [1, 5]);
    assert.deepEqual(env.drawSizes, ['48x27', '48x27', '640x360', '256x144']);
    manager.destroy();
});

test('video import keeps a blank poster when re-seeking does not help', async function () {
    var env = blankFrameDocument(function () { return 0; });
    var manager = (await import('../js/image/PhotoAssetManager.js')).createPhotoAssetManager({
        document: env.document,
        URL: {
            createObjectURL: function () { return 'blob:video'; },
            revokeObjectURL: function () {}
        }
    });
    var layers = await manager.createVideoLayers(new Blob(['mp4'], { type: 'video/mp4' }));

    assert.equal(layers.mediaType, 'video');
    assert.equal(layers.posterFallback, false);
    assert.equal(layers.workingWidth, 640);
    assert.deepEqual(env.seeks, [1, 5]);
    manager.destroy();
});
