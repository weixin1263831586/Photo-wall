import test from 'node:test';
import assert from 'node:assert/strict';
import {
    autosavePhotoFingerprint,
    autosavePhotoMetadata,
    createProjectAutosave
} from '../js/persistence/ProjectAutosave.js';
import { IDBFactory } from 'fake-indexeddb';

test('autosave photo metadata excludes decoded and temporary sources', function () {
    var photo = {
        id: 'photo-1',
        name: 'one.jpg',
        signature: 'one.jpg:42:1',
        featured: true,
        hue: 120,
        img: { naturalWidth: 10 },
        blob: new Blob(['photo'], { type: 'image/jpeg' }),
        src: 'blob:temporary'
    };
    assert.deepEqual(autosavePhotoMetadata(photo), {
        id: 'photo-1',
        name: 'one.jpg',
        signature: 'one.jpg:42:1',
        hue: 120,
        featured: true
    });
});

test('autosave fingerprint changes when persistent photo data changes', function () {
    var photo = { id: 'photo-1', signature: 'same-file' };
    var jpeg = new Blob(['one'], { type: 'image/jpeg' });
    var png = new Blob(['different'], { type: 'image/png' });
    assert.equal(autosavePhotoFingerprint(photo, jpeg), autosavePhotoFingerprint(photo, jpeg));
    assert.notEqual(autosavePhotoFingerprint(photo, jpeg), autosavePhotoFingerprint(photo, png));
});

test('autosave disables itself when IndexedDB is unavailable', async function () {
    var autosave = createProjectAutosave({ indexedDB: null });
    assert.equal(autosave.available, false);
    assert.equal(await autosave.saveNow(), null);
    assert.equal(await autosave.loadLatest(), null);
});

test('manual backups retain blobs and rotate to the five newest snapshots', async function () {
    var index = 0;
    var blob = new Blob(['photo-data'], { type: 'image/jpeg' });
    var autosave = createProjectAutosave({
        indexedDB: new IDBFactory(),
        databaseName: 'backup-test',
        capture: function () {
            index++;
            return {
                project: { format: 'photo-wall-project', version: 2, photos: [], marker: index },
                photos: [{ id: 'photo-1', name: 'one.jpg', originalBlob: blob }]
            };
        }
    });
    for (var count = 0; count < 7; count++) await autosave.createBackup('backup-' + count);
    var backups = await autosave.listBackups();
    assert.equal(backups.length, 5);
    var restored = await autosave.loadBackup(backups[0].id);
    assert.equal(restored.project.marker, 7);
    assert.equal(restored.project.photos[0].originalBlob.size, blob.size);
    autosave.destroy();
});

test('autosave stores and restores background music separately from project metadata', async function () {
    var photoBlob = new Blob(['photo'], { type: 'image/jpeg' });
    var musicBlob = new Blob(['music'], { type: 'audio/mpeg' });
    var autosave = createProjectAutosave({
        indexedDB: new IDBFactory(),
        databaseName: 'music-autosave-test',
        capture: function () {
            return {
                project: {
                    format: 'photo-wall-project', version: 2, photos: [],
                    backgroundMusic: { name: 'song.mp3', volume: 0.5, originalBlob: musicBlob }
                },
                photos: [{ id: 'photo-1', name: 'one.jpg', originalBlob: photoBlob }]
            };
        }
    });
    await autosave.saveNow();
    var restored = await autosave.loadLatest();
    assert.equal(restored.project.backgroundMusic.name, 'song.mp3');
    assert.equal(await restored.project.backgroundMusic.originalBlob.text(), 'music');
    autosave.destroy();
});
