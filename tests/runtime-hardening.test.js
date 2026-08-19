import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createTimeline } from '../js/playback/PlaybackTimeline.js';
import { createPhotoAssetManager } from '../js/image/PhotoAssetManager.js';
import { createProjectAutosave } from '../js/persistence/ProjectAutosave.js';

function layout() {
    return [
        { x: 10, y: 10, width: 20, height: 20, photoIndex: 0, boundaryDistance: 0 },
        { x: 50, y: 50, width: 20, height: 20, photoIndex: 1, boundaryDistance: 10 },
        { x: 90, y: 90, width: 20, height: 20, photoIndex: 2, boundaryDistance: 0 }
    ];
}

function openDatabase(factory, name) {
    return new Promise(function (resolve, reject) {
        var request = factory.open(name);
        request.onsuccess = function () { resolve(request.result); };
        request.onerror = function () { reject(request.error); };
    });
}

function transactionDone(transaction) {
    return new Promise(function (resolve, reject) {
        transaction.oncomplete = resolve;
        transaction.onerror = function () { reject(transaction.error); };
        transaction.onabort = function () { reject(transaction.error); };
    });
}

test('shuffle crossfades cells in the requested playback order', function () {
    var timeline = createTimeline(layout(), 'center-out', {
        mode: 'shuffle',
        canvasWidth: 100,
        canvasHeight: 100,
        seed: 17,
        interval: 1000,
        transition: 400,
        stagger: 100,
        cycles: 1
    });
    assert.equal(timeline.orderedIndices[0], 1, 'center cell should transition first');
    var early = timeline.getFrame(50);
    assert.ok(early.transitionProgresses[1] > 0, 'center cell has started');
    assert.equal(early.transitionProgresses[0], 0, 'corner cell has not started yet');
    assert.equal(early.transitionProgresses[2], 0, 'opposite corner has not started yet');
    var finished = timeline.getFrame(timeline.duration);
    assert.ok(Array.from(finished.transitionProgresses).every(function (value) { return value === 1; }));
});

test('asset manager keeps thumbnail bitmaps in a separate cache', async function () {
    var closed = 0;
    var manager = createPhotoAssetManager({
        createImageBitmap: async function () {
            return { width: 32, height: 24, close: function () { closed++; } };
        },
        maxWorkingEntries: 1,
        maxThumbnailEntries: 4
    });
    var photo = {
        id: 'asset-1', assetRevision: 1,
        workingBlob: new Blob(['working'], { type: 'image/jpeg' }),
        thumbnailBlob: new Blob(['thumb'], { type: 'image/webp' })
    };
    await manager.getBitmap(photo, 'thumbnail');
    var stats = manager.stats();
    assert.equal(stats.thumbnail.entries, 1);
    assert.equal(stats.working.entries, 0);
    manager.destroy();
    assert.equal(closed, 1);
});

test('autosave restores remaining photos when one stored blob is missing', async function () {
    var factory = new IDBFactory();
    var name = 'partial-autosave-test';
    var one = new Blob(['one'], { type: 'image/jpeg' });
    var two = new Blob(['two'], { type: 'image/jpeg' });
    var autosave = createProjectAutosave({
        indexedDB: factory,
        databaseName: name,
        capture: function () {
            return {
                project: { format: 'photo-wall-project', version: 2, photos: [] },
                photos: [
                    { id: 'one', name: 'one.jpg', originalBlob: one },
                    { id: 'two', name: 'two.jpg', originalBlob: two }
                ]
            };
        }
    });
    await autosave.saveNow();
    var database = await openDatabase(factory, name);
    var transaction = database.transaction('photos', 'readwrite');
    transaction.objectStore('photos').delete('two');
    await transactionDone(transaction);
    database.close();

    var restored = await autosave.loadLatest();
    assert.equal(restored.project.photos.length, 1);
    assert.equal(restored.project.photos[0].id, 'one');
    assert.equal(restored.skippedPhotoCount, 1);
    autosave.destroy();
});

test('mobile autosave rotates manual backups to two snapshots by default', async function () {
    var factory = new IDBFactory();
    var marker = 0;
    var autosave = createProjectAutosave({
        indexedDB: factory,
        databaseName: 'mobile-backup-limit-test',
        mobile: true,
        capture: function () {
            marker++;
            return {
                project: { format: 'photo-wall-project', version: 2, marker: marker, photos: [] },
                photos: [{ id: 'one', originalBlob: new Blob(['x'], { type: 'image/jpeg' }) }]
            };
        }
    });
    await autosave.createBackup('one');
    await autosave.createBackup('two');
    await autosave.createBackup('three');
    var backups = await autosave.listBackups();
    assert.equal(backups.length, 2);
    var latest = await autosave.loadBackup(backups[0].id);
    assert.equal(latest.project.marker, 3);
    autosave.destroy();
});
