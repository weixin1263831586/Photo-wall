const DEFAULT_DATABASE_NAME = 'photo-wall-autosave';
const DATABASE_VERSION = 2;
const PROJECT_STORE = 'projects';
const PHOTO_STORE = 'photos';
const BACKUP_STORE = 'backups';
const LATEST_PROJECT_ID = 'latest';

const PHOTO_METADATA_FIELDS = [
    'id', 'name', 'signature', 'r', 'g', 'b', 'brightness', 'hue',
    'saturation', 'contrast', 'sharpness', 'focusX', 'focusY',
    'aspectRatio', 'featured', 'editZoom', 'editOffsetX', 'editOffsetY',
    'editRotation', 'flipX', 'flipY', 'originalWidth', 'originalHeight',
    'mediaType', 'videoMime', 'duration', 'posterFallback', 'focusSource', 'subjectScore', 'analysisVersion'
];

function requestResult(request) {
    return new Promise(function (resolve, reject) {
        request.onsuccess = function () { resolve(request.result); };
        request.onerror = function () { reject(request.error || new Error('IndexedDB request failed')); };
    });
}

function transactionDone(transaction) {
    return new Promise(function (resolve, reject) {
        transaction.oncomplete = function () { resolve(); };
        transaction.onabort = function () { reject(transaction.error || new Error('IndexedDB transaction aborted')); };
        transaction.onerror = function () { reject(transaction.error || new Error('IndexedDB transaction failed')); };
    });
}

function openDatabase(factory, databaseName) {
    return new Promise(function (resolve, reject) {
        var request = factory.open(databaseName, DATABASE_VERSION);
        request.onupgradeneeded = function () {
            var database = request.result;
            if (!database.objectStoreNames.contains(PROJECT_STORE)) {
                database.createObjectStore(PROJECT_STORE, { keyPath: 'id' });
            }
            if (!database.objectStoreNames.contains(PHOTO_STORE)) {
                database.createObjectStore(PHOTO_STORE, { keyPath: 'id' });
            }
            if (!database.objectStoreNames.contains(BACKUP_STORE)) {
                database.createObjectStore(BACKUP_STORE, { keyPath: 'id' });
            }
        };
        request.onsuccess = function () { resolve(request.result); };
        request.onerror = function () { reject(request.error || new Error('Unable to open autosave database')); };
        request.onblocked = function () { reject(new Error('Autosave database upgrade is blocked')); };
    });
}

function isBlob(value) {
    return typeof Blob !== 'undefined' && value instanceof Blob;
}

export function autosavePhotoMetadata(photo) {
    var metadata = {};
    PHOTO_METADATA_FIELDS.forEach(function (field) {
        if (photo[field] !== undefined) metadata[field] = photo[field];
    });
    metadata.featured = photo.featured === true;
    return metadata;
}

export function autosavePhotoFingerprint(photo, blob) {
    return [
        photo.id || '',
        photo.signature || '',
        blob && Number.isFinite(blob.size) ? blob.size : 0,
        blob && blob.type ? blob.type : ''
    ].join(':');
}

async function resolvePhotoBlob(photo, fetchImpl) {
    if (isBlob(photo.originalBlob)) return photo.originalBlob;
    if (isBlob(photo.blob)) return photo.blob;
    if (typeof photo.src !== 'string' || !/^(blob:|data:(image|video)\/)/i.test(photo.src)) {
        throw new Error('Photo ' + (photo.id || '') + ' has no persistent source');
    }
    if (typeof fetchImpl !== 'function') throw new Error('Fetch is unavailable for autosave');
    var response = await fetchImpl(photo.src);
    if (!response.ok) throw new Error('Unable to read photo ' + (photo.id || ''));
    return response.blob();
}

/**
 * IndexedDB-backed latest-project snapshot. Photo blobs live in their own
 * object store so changing layout settings does not duplicate every image.
 */
export function createProjectAutosave(options) {
    options = options || {};
    var hasIndexedDBOption = Object.prototype.hasOwnProperty.call(options, 'indexedDB');
    var hasFetchOption = Object.prototype.hasOwnProperty.call(options, 'fetch');
    var factory = hasIndexedDBOption ? options.indexedDB :
        (typeof globalThis !== 'undefined' ? globalThis.indexedDB : null);
    var fetchImpl = hasFetchOption ? options.fetch :
        (typeof globalThis !== 'undefined' ? globalThis.fetch : null);
    var databaseName = options.databaseName || DEFAULT_DATABASE_NAME;
    var delay = Math.max(100, Number(options.delay) || 1500);
    var capture = options.capture;
    var onError = typeof options.onError === 'function' ? options.onError : function () {};
    var onSaved = typeof options.onSaved === 'function' ? options.onSaved : function () {};
    var databasePromise = null;
    var saveQueue = Promise.resolve();
    var timer = null;
    var suspended = false;
    var lastBackupId = 0;

    function database() {
        if (!factory) return Promise.reject(new Error('IndexedDB is unavailable'));
        if (!databasePromise) databasePromise = openDatabase(factory, databaseName);
        return databasePromise;
    }

    async function readLatestRecord(db) {
        var transaction = db.transaction(PROJECT_STORE, 'readonly');
        var result = await requestResult(transaction.objectStore(PROJECT_STORE).get(LATEST_PROJECT_ID));
        await transactionDone(transaction);
        return result;
    }

    async function persist(snapshot) {
        if (!snapshot || !snapshot.project || !Array.isArray(snapshot.photos)) {
            throw new Error('Invalid autosave snapshot');
        }
        var preparedPhotos = await Promise.all(snapshot.photos.map(async function (photo) {
            var blob = await resolvePhotoBlob(photo, fetchImpl);
            return {
                id: photo.id,
                blob: blob,
                metadata: autosavePhotoMetadata(photo),
                fingerprint: autosavePhotoFingerprint(photo, blob)
            };
        }));
        var db = await database();
        var previous = await readLatestRecord(db);
        var previousFingerprints = previous && previous.fingerprints ? previous.fingerprints : {};
        var fingerprints = {};
        var retainedIds = new Set();
        preparedPhotos.forEach(function (photo) {
            fingerprints[photo.id] = photo.fingerprint;
            retainedIds.add(photo.id);
        });

        var project = Object.assign({}, snapshot.project, {
            savedAt: new Date().toISOString(),
            photos: preparedPhotos.map(function (photo) { return photo.metadata; })
        });
        var transaction = db.transaction([PROJECT_STORE, PHOTO_STORE], 'readwrite');
        var projectStore = transaction.objectStore(PROJECT_STORE);
        var photoStore = transaction.objectStore(PHOTO_STORE);
        preparedPhotos.forEach(function (photo) {
            if (previousFingerprints[photo.id] !== photo.fingerprint) {
                photoStore.put({ id: photo.id, blob: photo.blob });
            }
        });
        Object.keys(previousFingerprints).forEach(function (id) {
            if (!retainedIds.has(id)) photoStore.delete(id);
        });
        projectStore.put({
            id: LATEST_PROJECT_ID,
            savedAt: project.savedAt,
            project: project,
            fingerprints: fingerprints
        });
        await transactionDone(transaction);
        onSaved({ savedAt: project.savedAt, photoCount: preparedPhotos.length });
        return project;
    }

    function enqueueSave(snapshot) {
        saveQueue = saveQueue.catch(function () {}).then(function () { return persist(snapshot); });
        return saveQueue;
    }

    function saveNow() {
        clearTimeout(timer);
        timer = null;
        if (suspended || typeof capture !== 'function' || !factory) return Promise.resolve(null);
        return Promise.resolve().then(capture).then(enqueueSave).catch(function (error) {
            onError(error);
            return null;
        });
    }

    function schedule() {
        if (suspended || !factory) return;
        clearTimeout(timer);
        timer = setTimeout(saveNow, delay);
    }

    async function loadLatest() {
        if (!factory) return null;
        var db = await database();
        var record = await readLatestRecord(db);
        if (!record || !record.project || !Array.isArray(record.project.photos)) return null;
        var transaction = db.transaction(PHOTO_STORE, 'readonly');
        var requests = record.project.photos.map(function (photo) {
            return requestResult(transaction.objectStore(PHOTO_STORE).get(photo.id));
        });
        var storedPhotos = await Promise.all(requests);
        await transactionDone(transaction);
        var photos = record.project.photos.map(function (metadata, index) {
            var stored = storedPhotos[index];
            if (!stored || !isBlob(stored.blob)) throw new Error('Autosave photo data is incomplete');
            return Object.assign({}, metadata, { originalBlob: stored.blob, blob: stored.blob });
        });
        return {
            savedAt: record.savedAt,
            project: Object.assign({}, record.project, { photos: photos })
        };
    }

    function clear() {
        clearTimeout(timer);
        timer = null;
        saveQueue = saveQueue.catch(function () {}).then(async function () {
            if (!factory) return;
            var db = await database();
            var transaction = db.transaction([PROJECT_STORE, PHOTO_STORE], 'readwrite');
            transaction.objectStore(PROJECT_STORE).clear();
            transaction.objectStore(PHOTO_STORE).clear();
            await transactionDone(transaction);
        });
        return saveQueue;
    }

    function createBackup(label) {
        if (typeof capture !== 'function' || !factory) return Promise.resolve(null);
        return Promise.resolve().then(capture).then(async function (snapshot) {
            var preparedPhotos = await Promise.all(snapshot.photos.map(async function (photo) {
                return {
                    metadata: autosavePhotoMetadata(photo),
                    blob: await resolvePhotoBlob(photo, fetchImpl)
                };
            }));
            var id = Math.max(Date.now(), lastBackupId + 1);
            lastBackupId = id;
            var record = {
                id: id,
                savedAt: new Date(id).toISOString(),
                label: label || '手动备份',
                project: Object.assign({}, snapshot.project, {
                    photos: preparedPhotos.map(function (photo) { return photo.metadata; })
                }),
                photos: preparedPhotos
            };
            var db = await database();
            var readTransaction = db.transaction(BACKUP_STORE, 'readonly');
            var keys = await requestResult(readTransaction.objectStore(BACKUP_STORE).getAllKeys());
            await transactionDone(readTransaction);
            keys.sort(function (a, b) { return Number(a) - Number(b); });
            var transaction = db.transaction(BACKUP_STORE, 'readwrite');
            var store = transaction.objectStore(BACKUP_STORE);
            store.put(record);
            while (keys.length >= 5) store.delete(keys.shift());
            await transactionDone(transaction);
            return { id: id, savedAt: record.savedAt, label: record.label, photoCount: preparedPhotos.length };
        }).catch(function (error) {
            onError(error);
            return null;
        });
    }

    async function listBackups() {
        if (!factory) return [];
        var db = await database();
        var transaction = db.transaction(BACKUP_STORE, 'readonly');
        var keys = await requestResult(transaction.objectStore(BACKUP_STORE).getAllKeys());
        await transactionDone(transaction);
        return keys.sort(function (a, b) { return Number(b) - Number(a); }).map(function (id) {
            return { id: id, savedAt: new Date(Number(id)).toISOString() };
        });
    }

    async function loadBackup(id) {
        if (!factory) return null;
        var db = await database();
        var transaction = db.transaction(BACKUP_STORE, 'readonly');
        var record = await requestResult(transaction.objectStore(BACKUP_STORE).get(id));
        await transactionDone(transaction);
        if (!record || !record.project || !Array.isArray(record.photos)) return null;
        return {
            savedAt: record.savedAt,
            label: record.label,
            project: Object.assign({}, record.project, {
                photos: record.photos.map(function (photo) {
                    return Object.assign({}, photo.metadata, { originalBlob: photo.blob, blob: photo.blob });
                })
            })
        };
    }

    function destroy() {
        clearTimeout(timer);
        timer = null;
        if (databasePromise) {
            databasePromise.then(function (db) { db.close(); }).catch(function () {});
            databasePromise = null;
        }
    }

    return {
        available: Boolean(factory),
        schedule: schedule,
        saveNow: saveNow,
        loadLatest: loadLatest,
        clear: clear,
        createBackup: createBackup,
        listBackups: listBackups,
        loadBackup: loadBackup,
        suspend: function () { suspended = true; clearTimeout(timer); timer = null; },
        resume: function () { suspended = false; },
        destroy: destroy
    };
}
