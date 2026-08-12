function bitmapSize(bitmap) {
    return Math.max(1, Number(bitmap && bitmap.width) || 1) *
        Math.max(1, Number(bitmap && bitmap.height) || 1);
}

function closeBitmap(bitmap) {
    if (bitmap && typeof bitmap.close === 'function') bitmap.close();
}

/** Explicitly bounded decoded-image cache. Evicted ImageBitmaps are closed. */
export function createBitmapLRU(options) {
    options = options || {};
    var maxEntries = Math.max(1, Number(options.maxEntries) || 80);
    var maxPixels = Math.max(1000000, Number(options.maxPixels) || 80000000);
    var decode = options.decode || function (blob) { return createImageBitmap(blob); };
    var entries = new Map();
    var pending = new Map();
    var versions = new Map();
    var totalPixels = 0;

    function touch(key, entry) {
        entries.delete(key);
        entries.set(key, entry);
    }

    function evict() {
        while ((entries.size > maxEntries || totalPixels > maxPixels) && entries.size > 1) {
            var oldestKey = entries.keys().next().value;
            var oldest = entries.get(oldestKey);
            entries.delete(oldestKey);
            totalPixels -= oldest.pixels;
            closeBitmap(oldest.bitmap);
        }
    }

    function get(key, blob) {
        var cached = entries.get(key);
        if (cached) {
            touch(key, cached);
            return Promise.resolve(cached.bitmap);
        }
        if (pending.has(key)) return pending.get(key);
        var version = versions.get(key) || 0;
        var request = Promise.resolve().then(function () { return decode(blob); }).then(function (bitmap) {
            if (version !== (versions.get(key) || 0)) {
                closeBitmap(bitmap);
                throw new Error('Bitmap decode was cancelled');
            }
            if (pending.get(key) === request) pending.delete(key);
            var pixels = bitmapSize(bitmap);
            var previous = entries.get(key);
            if (previous) {
                totalPixels -= previous.pixels;
                closeBitmap(previous.bitmap);
            }
            entries.set(key, { bitmap: bitmap, pixels: pixels });
            totalPixels += pixels;
            evict();
            return bitmap;
        }).catch(function (error) {
            if (pending.get(key) === request) pending.delete(key);
            if (!pending.has(key) && !entries.has(key) && version !== (versions.get(key) || 0)) versions.delete(key);
            throw error;
        });
        pending.set(key, request);
        return request;
    }

    function peek(key) {
        var cached = entries.get(key);
        if (!cached) return null;
        touch(key, cached);
        return cached.bitmap;
    }

    function remove(key) {
        var hadPending = pending.has(key);
        versions.set(key, (versions.get(key) || 0) + 1);
        pending.delete(key);
        var cached = entries.get(key);
        if (!cached) {
            if (!hadPending) versions.delete(key);
            return false;
        }
        entries.delete(key);
        totalPixels -= cached.pixels;
        closeBitmap(cached.bitmap);
        if (!hadPending) versions.delete(key);
        return true;
    }

    function removePrefix(prefix) {
        new Set(Array.from(entries.keys()).concat(Array.from(pending.keys()))).forEach(function (key) {
            if (key.startsWith(prefix)) remove(key);
        });
    }

    function clear() {
        Array.from(pending.keys()).forEach(function (key) {
            versions.set(key, (versions.get(key) || 0) + 1);
        });
        entries.forEach(function (entry) { closeBitmap(entry.bitmap); });
        entries.clear();
        pending.clear();
        totalPixels = 0;
    }

    return {
        get: get,
        peek: peek,
        remove: remove,
        removePrefix: removePrefix,
        clear: clear,
        stats: function () {
            return { entries: entries.size, pending: pending.size, pixels: totalPixels };
        }
    };
}

function canvasBlob(canvas, mime, quality) {
    return new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) {
            if (blob) resolve(blob);
            else reject(new Error('Image encode failed'));
        }, mime, quality);
    });
}

function imageDimensions(image) {
    return {
        width: Number(image.width || image.naturalWidth) || 1,
        height: Number(image.height || image.naturalHeight) || 1
    };
}

async function resizeImage(image, maxDimension, mime, quality, documentRef) {
    var dimensions = imageDimensions(image);
    var maxSide = Math.max(dimensions.width, dimensions.height);
    var scale = Math.min(1, maxDimension / Math.max(1, maxSide));
    var width = Math.max(1, Math.round(dimensions.width * scale));
    var height = Math.max(1, Math.round(dimensions.height * scale));
    var canvas = documentRef.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    var context = canvas.getContext('2d');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, width, height);
    var blob = await canvasBlob(canvas, mime, quality);
    canvas.width = 1;
    canvas.height = 1;
    return { blob: blob, width: width, height: height };
}

function fallbackDecode(blob, urlAPI, ImageCtor) {
    return new Promise(function (resolve, reject) {
        var url = urlAPI.createObjectURL(blob);
        var image = new ImageCtor();
        image.onload = function () {
            urlAPI.revokeObjectURL(url);
            resolve(image);
        };
        image.onerror = function () {
            urlAPI.revokeObjectURL(url);
            reject(new Error('Image decode failed'));
        };
        image.src = url;
    });
}

export function createPhotoAssetManager(options) {
    options = options || {};
    var documentRef = options.document || (typeof document !== 'undefined' ? document : null);
    var urlAPI = options.URL || (typeof URL !== 'undefined' ? URL : null);
    var ImageCtor = options.Image || (typeof Image !== 'undefined' ? Image : null);
    var createBitmap = options.createImageBitmap ||
        (typeof globalThis !== 'undefined' ? globalThis.createImageBitmap : null);
    var thumbnailDimension = Math.max(96, Number(options.thumbnailDimension) || 256);
    var urlsByPhoto = new Map();
    var revision = 0;

    function decode(blob) {
        if (typeof createBitmap === 'function') {
            return Promise.resolve(createBitmap(blob, { imageOrientation: 'from-image' })).catch(function () {
                return createBitmap(blob);
            });
        }
        if (!urlAPI || !ImageCtor) return Promise.reject(new Error('No image decoder is available'));
        return fallbackDecode(blob, urlAPI, ImageCtor);
    }

    var workingCache = createBitmapLRU({
        maxEntries: options.maxWorkingEntries || 80,
        maxPixels: options.maxWorkingPixels || 80000000,
        decode: decode
    });
    var originalCache = createBitmapLRU({
        maxEntries: options.maxOriginalEntries || 8,
        maxPixels: options.maxOriginalPixels || 50000000,
        decode: decode
    });

    function revokePhotoURLs(photoId) {
        var urls = urlsByPhoto.get(photoId);
        if (urls && urlAPI) Object.keys(urls).forEach(function (key) {
            if (urls[key]) urlAPI.revokeObjectURL(urls[key]);
        });
        urlsByPhoto.delete(photoId);
    }

    function attachURLs(photo) {
        if (!urlAPI) return photo;
        revokePhotoURLs(photo.id);
        var urls = {
            working: urlAPI.createObjectURL(photo.workingBlob || photo.blob || photo.originalBlob),
            thumbnail: urlAPI.createObjectURL(photo.thumbnailBlob || photo.workingBlob || photo.blob || photo.originalBlob)
        };
        urlsByPhoto.set(photo.id, urls);
        photo.src = urls.working;
        photo.workingSrc = urls.working;
        photo.thumbnailSrc = urls.thumbnail;
        return photo;
    }

    async function createLayers(originalBlob, maxWorkingDimension) {
        if (!(originalBlob instanceof Blob)) throw new Error('Photo source must be a Blob');
        if (!documentRef) throw new Error('A document is required to create photo layers');
        var source = await decode(originalBlob);
        var dimensions = imageDimensions(source);
        var mime = /^image\/(jpeg|png|webp)$/i.test(originalBlob.type) ? originalBlob.type : 'image/jpeg';
        var workingLimit = Math.max(320, Number(maxWorkingDimension) || 1600);
        var working = Math.max(dimensions.width, dimensions.height) <= workingLimit ?
            { blob: originalBlob, width: dimensions.width, height: dimensions.height } :
            await resizeImage(source, workingLimit, mime, mime === 'image/png' ? undefined : 0.9, documentRef);
        var thumbnail = Math.max(dimensions.width, dimensions.height) <= thumbnailDimension ?
            { blob: originalBlob, width: dimensions.width, height: dimensions.height } :
            await resizeImage(source, thumbnailDimension, 'image/webp', 0.82, documentRef);
        closeBitmap(source);
        return {
            originalBlob: originalBlob,
            workingBlob: working.blob,
            thumbnailBlob: thumbnail.blob,
            originalWidth: dimensions.width,
            originalHeight: dimensions.height,
            workingWidth: working.width,
            workingHeight: working.height,
            thumbnailWidth: thumbnail.width,
            thumbnailHeight: thumbnail.height
        };
    }

    function hydratePhoto(photo, layers) {
        Object.assign(photo, layers);
        photo.blob = layers.workingBlob;
        photo.assetRevision = ++revision;
        attachURLs(photo);
        return photo;
    }

    function layerBlob(photo, layer) {
        if (layer === 'original') return photo.originalBlob || photo.workingBlob || photo.blob;
        if (layer === 'thumbnail') return photo.thumbnailBlob || photo.workingBlob || photo.blob || photo.originalBlob;
        return photo.workingBlob || photo.blob || photo.originalBlob;
    }

    function cacheKey(photo, layer) {
        return photo.id + ':' + (photo.assetRevision || 0) + ':' + layer;
    }

    function getBitmap(photo, layer) {
        layer = layer === 'original' ? 'original' : 'working';
        var blob = layerBlob(photo, layer);
        if (!(blob instanceof Blob)) return Promise.reject(new Error('Photo layer is unavailable'));
        return (layer === 'original' ? originalCache : workingCache).get(cacheKey(photo, layer), blob);
    }

    function peekBitmap(photo, layer) {
        layer = layer === 'original' ? 'original' : 'working';
        return (layer === 'original' ? originalCache : workingCache).peek(cacheKey(photo, layer));
    }

    function releasePhoto(photo) {
        if (!photo) return;
        revokePhotoURLs(photo.id);
        workingCache.removePrefix(photo.id + ':');
        originalCache.removePrefix(photo.id + ':');
        releaseElement(photo);
    }

    function releaseElement(photo) {
        if (!photo) return;
        if (photo.img) {
            photo.img.onload = null;
            photo.img.onerror = null;
            photo.img.src = '';
            photo.img = null;
        }
    }

    function destroy() {
        Array.from(urlsByPhoto.keys()).forEach(revokePhotoURLs);
        workingCache.clear();
        originalCache.clear();
    }

    return {
        createLayers: createLayers,
        hydratePhoto: hydratePhoto,
        attachURLs: attachURLs,
        getBitmap: getBitmap,
        peekBitmap: peekBitmap,
        layerBlob: layerBlob,
        releaseElement: releaseElement,
        releasePhoto: releasePhoto,
        destroy: destroy,
        stats: function () {
            return { working: workingCache.stats(), original: originalCache.stats(), urls: urlsByPhoto.size };
        }
    };
}
