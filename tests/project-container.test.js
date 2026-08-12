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
