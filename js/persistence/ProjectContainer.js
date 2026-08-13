import { strFromU8, strToU8, unzip, zip } from 'fflate';

const FORMAT = 'photo-wall-project';
const CONTAINER_VERSION = 2;
const MAX_FILES = 2200;
const MAX_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024;

function zipAsync(files) {
    return new Promise(function (resolve, reject) {
        zip(files, { level: 0 }, function (error, data) {
            if (error) reject(error);
            else resolve(data);
        });
    });
}

function unzipAsync(data) {
    return new Promise(function (resolve, reject) {
        var fileCount = 0;
        var totalBytes = 0;
        unzip(data, {
            filter: function (file) {
                fileCount++;
                totalBytes += Number(file.originalSize) || 0;
                var safePath = file.name === 'manifest.json' || file.name === 'project.json' ||
                    /^(photos|thumbnails)\/[a-zA-Z0-9._-]+$/.test(file.name);
                if (!safePath) throw new Error('Project contains an unsafe ZIP entry');
                if (fileCount > MAX_FILES || totalBytes > MAX_UNCOMPRESSED_BYTES || file.originalSize > 220 * 1024 * 1024) {
                    throw new Error('Project expands beyond the safe limit');
                }
                return true;
            }
        }, function (error, files) {
            if (error) reject(error);
            else resolve(files);
        });
    });
}

function safeId(value, index) {
    var normalized = String(value || 'photo-' + index).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
    return normalized || 'photo-' + index;
}

function extensionForMime(mime) {
    if (mime === 'image/png') return 'png';
    if (mime === 'image/webp') return 'webp';
    if (mime === 'video/mp4') return 'mp4';
    if (mime === 'video/webm') return 'webm';
    if (mime === 'video/quicktime') return 'mov';
    if (mime === 'video/x-m4v') return 'm4v';
    return 'jpg';
}

async function blobBytes(blob) {
    return new Uint8Array(await blob.arrayBuffer());
}

function projectMetadata(project) {
    var clean = Object.assign({}, project, { version: CONTAINER_VERSION });
    clean.photos = (project.photos || []).map(function (photo) {
        var metadata = Object.assign({}, photo);
        delete metadata.src;
        delete metadata.blob;
        delete metadata.originalBlob;
        delete metadata.workingBlob;
        delete metadata.thumbnailBlob;
        delete metadata.img;
        return metadata;
    });
    return clean;
}

export function isPhotowallContainer(data) {
    var bytes = data instanceof Uint8Array ? data : new Uint8Array(data || 0);
    return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b &&
        (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07);
}

export async function createProjectContainer(project, photos, options) {
    options = options || {};
    if (!project || project.format !== FORMAT || !Array.isArray(photos)) {
        throw new Error('Invalid Photo Wall project');
    }
    var files = {};
    var manifestPhotos = [];
    for (var index = 0; index < photos.length; index++) {
        var photo = photos[index];
        var original = photo.originalBlob || photo.workingBlob || photo.blob;
        if (!(original instanceof Blob)) throw new Error('Photo source is missing: ' + (photo.id || index));
        var id = safeId(photo.id, index) + '-' + index;
        var originalPath = 'photos/' + id + '.' + extensionForMime(original.type);
        files[originalPath] = [await blobBytes(original), { level: 0 }];
        var thumbnail = photo.thumbnailBlob;
        var thumbnailPath = null;
        if (thumbnail instanceof Blob) {
            thumbnailPath = 'thumbnails/' + id + '.' + extensionForMime(thumbnail.type);
            files[thumbnailPath] = [await blobBytes(thumbnail), { level: 0 }];
        }
        manifestPhotos.push({
            id: photo.id,
            original: originalPath,
            originalType: original.type || 'image/jpeg',
            thumbnail: thumbnailPath,
            thumbnailType: thumbnail && thumbnail.type
        });
    }
    var cleanProject = projectMetadata(project);
    var manifest = {
        format: FORMAT,
        containerVersion: CONTAINER_VERSION,
        appVersion: options.appVersion || '1.0.0',
        createdAt: new Date().toISOString(),
        project: 'project.json',
        photoCount: photos.length,
        photos: manifestPhotos
    };
    files['manifest.json'] = [strToU8(JSON.stringify(manifest)), { level: 6 }];
    files['project.json'] = [strToU8(JSON.stringify(cleanProject)), { level: 6 }];
    var archive = await zipAsync(files);
    return new Blob([archive], { type: 'application/x-photowall' });
}

function parseJsonFile(files, path) {
    if (!files[path]) throw new Error('Project entry is missing: ' + path);
    try {
        return JSON.parse(strFromU8(files[path]));
    } catch (error) {
        throw new Error('Project JSON is invalid: ' + path);
    }
}

export async function openProjectContainer(source) {
    var bytes = source instanceof Uint8Array ? source : new Uint8Array(await source.arrayBuffer());
    if (!isPhotowallContainer(bytes)) throw new Error('Not a .photowall container');
    if (bytes.byteLength > MAX_UNCOMPRESSED_BYTES) throw new Error('Project archive is too large');
    var files = await unzipAsync(bytes);
    var paths = Object.keys(files);
    if (paths.length > MAX_FILES) throw new Error('Project contains too many files');
    var totalBytes = paths.reduce(function (total, path) { return total + files[path].byteLength; }, 0);
    if (totalBytes > MAX_UNCOMPRESSED_BYTES) throw new Error('Project is too large after extraction');
    var manifest = parseJsonFile(files, 'manifest.json');
    if (manifest.format !== FORMAT || manifest.containerVersion !== CONTAINER_VERSION || !Array.isArray(manifest.photos)) {
        throw new Error('Unsupported .photowall container version');
    }
    var project = parseJsonFile(files, manifest.project || 'project.json');
    if (project.format !== FORMAT || !Array.isArray(project.photos)) throw new Error('Invalid project metadata');
    if (manifest.photos.length !== project.photos.length || manifest.photoCount !== project.photos.length) {
        throw new Error('Project manifest photo count is inconsistent');
    }
    var assetsById = new Map();
    manifest.photos.forEach(function (asset) {
        if (!asset || typeof asset.id !== 'string' || assetsById.has(asset.id)) {
            throw new Error('Project contains duplicate photo identifiers');
        }
        assetsById.set(asset.id, asset);
    });
    project.photos = project.photos.map(function (metadata) {
        var asset = assetsById.get(metadata.id);
        if (!asset || !files[asset.original]) throw new Error('Photo asset is missing: ' + metadata.id);
        var originalBlob = new Blob([files[asset.original]], { type: asset.originalType || 'image/jpeg' });
        var thumbnailBlob = asset.thumbnail && files[asset.thumbnail] ?
            new Blob([files[asset.thumbnail]], { type: asset.thumbnailType || 'image/webp' }) : null;
        return Object.assign({}, metadata, {
            originalBlob: originalBlob,
            blob: originalBlob,
            thumbnailBlob: thumbnailBlob
        });
    });
    return { manifest: manifest, project: migrateProject(project) };
}

export function migrateProject(project) {
    if (!project || project.format !== FORMAT || !Array.isArray(project.photos)) {
        throw new Error('Invalid Photo Wall project');
    }
    var version = Number(project.version) || 1;
    if (version > CONTAINER_VERSION) throw new Error('Project was created by a newer app version');
    var migrated = Object.assign({}, project, { version: CONTAINER_VERSION });
    migrated.settings = Object.assign({
        density: 1,
        gap: 0,
        placementMode: 'grid',
        photoShape: 'square',
        smartPlacement: true,
        mixedSizes: true,
        rotationRange: 0,
        layoutSeed: 1
    }, project.settings || {});
    migrated.photos = project.photos.map(function (photo) {
        return Object.assign({
            mediaType: 'image',
            videoMime: '',
            duration: 0,
            posterFallback: false,
            focusSource: 'saliency',
            subjectScore: 0,
            analysisVersion: 1,
            editZoom: 1,
            editOffsetX: 0,
            editOffsetY: 0,
            editRotation: 0,
            flipX: false,
            flipY: false
        }, photo);
    });
    migrated.overlays = Array.isArray(project.overlays) ? project.overlays : [];
    return migrated;
}

export const PROJECT_CONTAINER_VERSION = CONTAINER_VERSION;
