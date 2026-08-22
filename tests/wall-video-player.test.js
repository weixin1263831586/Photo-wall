import test from 'node:test';
import assert from 'node:assert/strict';
import { createWallVideoPlayer } from '../js/video/WallVideoPlayer.js';

function createFakeVideoElement(log) {
    var listeners = {};
    var element = {
        muted: false,
        loop: false,
        playsInline: false,
        preload: '',
        src: '',
        readyState: 0,
        parentNode: null,
        style: { cssText: '' },
        setAttribute: function (name, value) { element['attr-' + name] = value; },
        removeAttribute: function () { element.src = ''; },
        addEventListener: function (type, handler) {
            (listeners[type] = listeners[type] || []).push(handler);
        },
        dispatch: function (type) {
            (listeners[type] || []).forEach(function (handler) { handler({}); });
        },
        load: function () { log.push('load'); },
        pause: function () { log.push('pause'); element.paused = true; },
        play: function () {
            log.push('play');
            element.paused = false;
            return Promise.resolve();
        }
    };
    element.__markReady = function () {
        element.readyState = 2;
        element.dispatch('loadeddata');
    };
    return element;
}

function createFakeDocument(log) {
    log.elements = [];
    function createNode(tag) {
        return {
            tagName: tag.toUpperCase(),
            children: [],
            parentNode: null,
            style: { cssText: '' },
            setAttribute: function () {},
            appendChild: function (node) {
                this.children.push(node);
                node.parentNode = this;
                return node;
            },
            removeChild: function (node) {
                var index = this.children.indexOf(node);
                if (index >= 0) this.children.splice(index, 1);
                node.parentNode = null;
                return node;
            }
        };
    }
    return {
        hidden: false,
        listeners: {},
        removedListeners: [],
        body: createNode('body'),
        createElement: function (tag) {
            var node = createNode(tag);
            if (tag === 'video') {
                var element = createFakeVideoElement(log);
                Object.assign(element, node, {
                    style: element.style,
                    setAttribute: element.setAttribute,
                    addEventListener: element.addEventListener,
                    appendChild: function () {},
                    removeChild: function () {},
                    children: [],
                    __tag: tag
                });
                element.parentNode = null;
                log.elements.push(element);
                return element;
            }
            return node;
        },
        addEventListener: function (type, handler) {
            (this.listeners[type] = this.listeners[type] || []).push(handler);
        },
        removeEventListener: function (type, handler) {
            this.removedListeners.push({ type: type, handler: handler });
            var list = this.listeners[type] || [];
            var index = list.indexOf(handler);
            if (index >= 0) list.splice(index, 1);
        }
    };
}

function createHarness(options) {
    var log = [];
    var revoked = [];
    var urlCounter = 0;
    var harness = {
        log: log,
        revoked: revoked,
        document: createFakeDocument(log),
        URL: {
            createObjectURL: function () { return 'blob:' + (++urlCounter); },
            revokeObjectURL: function (url) { revoked.push(url); }
        }
    };
    harness.player = createWallVideoPlayer(Object.assign({
        document: harness.document,
        URL: harness.URL
    }, options || {}));
    harness.lastElement = function () {
        return harness.log.elements[harness.log.elements.length - 1] || null;
    };
    return harness;
}

function videoPhoto(id, overrides) {
    return Object.assign({
        id: id,
        mediaType: 'video',
        posterFallback: false,
        originalBlob: { size: 42 }
    }, overrides || {});
}

function flush() {
    return new Promise(function (resolve) { setImmediate(resolve); });
}

test('sync creates a muted looping inline video element for playable videos', function () {
    var harness = createHarness();
    var photo = videoPhoto('v1');
    harness.player.sync([photo, { id: 'img1', mediaType: 'image', originalBlob: {} }]);
    assert.equal(harness.log.elements.length, 1, 'one element per playable video');
    var element = harness.log.elements[0];
    assert.ok(element.parentNode, 'element attached to the hidden container');
    assert.ok(harness.log.indexOf('play') >= 0);
    var videos = harness.player.stats();
    assert.equal(videos.entries, 1);
    assert.equal(videos.failed, 0);
});

test('get() returns the element only after a decodable frame exists', async function () {
    var harness = createHarness();
    var photo = videoPhoto('v1');
    harness.player.sync([photo]);
    assert.equal(harness.player.get(photo), null, 'not ready before loadeddata');

    /* Reach into the pool through the activity of the appended element. */
    var entry = harness.player.get({ id: 'missing' });
    assert.equal(entry, null);

    /* Simulate the loadeddata path by driving the document element directly. */
    var element = harness.lastElement();
    assert.ok(element, 'fake document should expose created elements');
    assert.equal(element.muted, true);
    assert.equal(element.loop, true);
    assert.equal(element.playsInline, true);
    assert.equal(element.src.indexOf('blob:'), 0);

    element.__markReady();
    assert.equal(harness.player.get(photo), element);
    assert.equal(harness.player.hasReady(), true);
});

test('posterFallback videos are excluded from the looping pool', function () {
    var harness = createHarness();
    var photo = videoPhoto('v1', { posterFallback: true });
    harness.player.sync([photo]);
    assert.equal(harness.player.stats().entries, 0);
});

test('sync releases entries for photos that left the wall', async function () {
    var harness = createHarness();
    var photo = videoPhoto('v1');
    harness.player.sync([photo]);
    var element = harness.lastElement();
    element.__markReady();
    assert.equal(harness.player.hasReady(), true);

    harness.player.sync([]);
    assert.equal(harness.player.stats().entries, 0);
    assert.equal(harness.revoked.length, 1);
    assert.equal(harness.log.indexOf('pause') >= 0, true);
    assert.equal(element.parentNode, null, 'element detached from the container');
});

test('a decode error permanently falls the photo back to its poster', async function () {
    var decoded = [];
    var harness = createHarness({ onDecodeError: function (photo) { decoded.push(photo.id); } });
    var photo = videoPhoto('v1');
    harness.player.sync([photo]);
    var element = harness.lastElement();
    element.dispatch('error');
    await flush();
    assert.equal(harness.player.stats().entries, 0);
    assert.equal(harness.player.stats().failed, 1);
    assert.deepEqual(decoded, ['v1'], 'the platform compatibility queue is notified');
    harness.player.sync([photo]);
    assert.equal(harness.player.stats().entries, 0, 'failed photo is not retried');
});

test('the pool is capped so devices with many videos stay responsive', function () {
    var harness = createHarness({ maxConcurrent: 2 });
    var photos = [videoPhoto('v1'), videoPhoto('v2'), videoPhoto('v3')];
    harness.player.sync(photos);
    assert.equal(harness.player.stats().entries, 2);
    /* Removing the first video frees capacity for the third. */
    harness.player.sync(photos.slice(1));
    assert.equal(harness.player.stats().entries, 2);
});

test('videos beyond the decoder cap rotate into active wall playback', async function () {
    var harness = createHarness({ maxConcurrent: 2, rotationInterval: 25 });
    var photos = [videoPhoto('v1'), videoPhoto('v2'), videoPhoto('v3'), videoPhoto('v4')];
    harness.player.sync(photos);
    assert.equal(harness.player.stats().entries, 2);
    await new Promise(function (resolve) { setTimeout(resolve, 45); });
    assert.equal(harness.player.stats().entries, 2);
    assert.ok(harness.log.elements.length >= 4, 'the next decoder window was created');
    assert.ok(harness.revoked.length >= 2, 'the previous decoder window was released');
    harness.player.destroy();
});

test('manual export remains bounded and seeks visible videos on demand', async function () {
    var harness = createHarness({ maxConcurrent: 2, seekTimeout: 250 });
    var photos = [videoPhoto('v1'), videoPhoto('v2'), videoPhoto('v3')];
    harness.player.sync(photos);
    var begin = harness.player.beginExport(photos, { manualFrames: true });
    harness.log.elements.forEach(function (element) {
        element.duration = 2;
        element.__markReady();
    });
    await begin;
    assert.equal(harness.player.stats().entries, 2, 'export keeps the device decoder cap');

    var seeking = harness.player.prepareFrame(1500);
    await flush();
    harness.log.elements.slice(-2).forEach(function (element) { element.dispatch('seeked'); });
    await seeking;
    harness.log.elements.slice(-2).forEach(function (element) {
        assert.equal(element.currentTime, 1.5);
        assert.equal(element.paused, true);
    });

    var thirdFrame = harness.player.preparePhotoFrame(photos[2], 750);
    await flush();
    var thirdElement = harness.lastElement();
    thirdElement.duration = 2;
    thirdElement.__markReady();
    await flush();
    thirdElement.dispatch('seeked');
    assert.equal(await thirdFrame, thirdElement);
    assert.equal(thirdElement.currentTime, 0.75);
    assert.equal(harness.player.stats().entries, 2, 'on-demand source evicts through the LRU');

    harness.player.endExport();
    assert.equal(harness.player.stats().entries, 2, 'preview returns to its bounded decoder pool');
    harness.player.destroy();
});

test('visibilitychange pauses and resumes the looping elements', async function () {
    var harness = createHarness();
    var photo = videoPhoto('v1');
    harness.player.sync([photo]);
    var element = harness.lastElement();

    harness.document.hidden = true;
    harness.document.listeners.visibilitychange.forEach(function (handler) { handler({}); });
    assert.equal(element.paused, true);

    harness.document.hidden = false;
    harness.document.listeners.visibilitychange.forEach(function (handler) { handler({}); });
    assert.equal(element.paused, false);
});

test('destroy tears down every entry', function () {
    var harness = createHarness();
    var photos = [videoPhoto('v1'), videoPhoto('v2')];
    harness.player.sync(photos);
    harness.player.destroy();
    assert.equal(harness.player.stats().entries, 0);
    assert.equal(harness.revoked.length, 2);
    assert.equal((harness.document.listeners.visibilitychange || []).length, 0);
});
