import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createProjectContainer,
    isPhotowallContainer,
    migrateProject,
    openProjectContainer
} from '../js/persistence/ProjectContainer.js';

test('photowall v2 container round-trips metadata and photo blobs', async function () {
    var photoBlob = new Blob(['original-photo'], { type: 'image/jpeg' });
    var thumbnailBlob = new Blob(['thumbnail'], { type: 'image/webp' });
    var project = {
        format: 'photo-wall-project',
        version: 2,
        settings: { density: 1 },
        shape: { key: 'heart' },
        photos: [{ id: 'photo-1', name: 'one.jpg', src: 'blob:temporary' }],
        layout: { items: [] }
    };
    var archive = await createProjectContainer(project, [{
        id: 'photo-1',
        originalBlob: photoBlob,
        thumbnailBlob: thumbnailBlob
    }]);
    var bytes = new Uint8Array(await archive.arrayBuffer());
    assert.equal(isPhotowallContainer(bytes), true);

    var restored = await openProjectContainer(archive);
    assert.equal(restored.project.version, 2);
    assert.equal(restored.project.photos[0].name, 'one.jpg');
    assert.equal(await restored.project.photos[0].originalBlob.text(), 'original-photo');
    assert.equal(await restored.project.photos[0].thumbnailBlob.text(), 'thumbnail');
    assert.equal(restored.project.photos[0].src, undefined);
});

test('v1 JSON projects migrate with safe editing defaults', function () {
    var migrated = migrateProject({
        format: 'photo-wall-project',
        version: 1,
        photos: [{ id: 'legacy', src: 'data:image/png;base64,AA==' }]
    });
    assert.equal(migrated.version, 2);
    assert.equal(migrated.settings.layoutSeed, 1);
    assert.equal(migrated.photos[0].editZoom, 1);
    assert.deepEqual(migrated.overlays, []);
});

test('photowall v2 preserves an original video and its poster metadata', async function () {
    var videoBlob = new Blob(['original-video-bytes'], { type: 'video/mp4' });
    var posterBlob = new Blob(['poster'], { type: 'image/webp' });
    var project = {
        format: 'photo-wall-project',
        version: 2,
        photos: [{ id: 'video-1', name: 'clip.mp4', mediaType: 'video', duration: 12.5 }]
    };
    var archive = await createProjectContainer(project, [{
        id: 'video-1', originalBlob: videoBlob, thumbnailBlob: posterBlob
    }]);
    var restored = await openProjectContainer(archive);
    assert.equal(restored.project.photos[0].mediaType, 'video');
    assert.equal(restored.project.photos[0].duration, 12.5);
    assert.equal(restored.project.photos[0].originalBlob.type, 'video/mp4');
    assert.equal(await restored.project.photos[0].originalBlob.text(), 'original-video-bytes');
});

test('photowall v2 preserves background music and its edit settings', async function () {
    var photoBlob = new Blob(['photo'], { type: 'image/jpeg' });
    var musicBlob = new Blob(['music-bytes'], { type: 'audio/mpeg' });
    var project = {
        format: 'photo-wall-project', version: 2,
        photos: [{ id: 'photo-1', name: 'one.jpg' }],
        backgroundMusic: { name: 'song.mp3', volume: 0.6, startTime: 3, loop: true, originalBlob: musicBlob }
    };
    var archive = await createProjectContainer(project, [{ id: 'photo-1', originalBlob: photoBlob }], {
        backgroundMusic: project.backgroundMusic
    });
    var restored = await openProjectContainer(archive);
    assert.equal(restored.project.backgroundMusic.name, 'song.mp3');
    assert.equal(restored.project.backgroundMusic.volume, 0.6);
    assert.equal(restored.project.backgroundMusic.originalBlob.type, 'audio/mpeg');
    assert.equal(await restored.project.backgroundMusic.originalBlob.text(), 'music-bytes');
});
