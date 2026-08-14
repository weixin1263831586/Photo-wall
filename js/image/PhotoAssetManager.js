function bitmapSize(bitmap) {
    return Math.max(1, Number(bitmap && bitmap.width) || 1) *
        Math.max(1, Number(bitmap && bitmap.height) || 1);
}

function closeBitmap(bitmap) {
    if (!bitmap) return;
    if (typeof bitmap.close === 'function') bitmap.close();
    else if (typeof bitmap.__photoWallRelease === 'function') bitmap.__photoWallRelease();
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
        width: Number(image.videoWidth || image.width || image.naturalWidth) || 1,
        height: Number(image.videoHeight || image.height || image.naturalHeight) || 1
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
        var released = false;

        function release() {
            if (released) return;
            released = true;
            image.onload = null;
            image.onerror = null;
            try {
                if (typeof image.removeAttribute === 'function') image.removeAttribute('src');
                else image.src = '';
            } catch (ignore) {}
            urlAPI.revokeObjectURL(url);
        }
        image.onload = function () {
            image.onload = null;
            image.onerror = null;
            image.__photoWallRelease = release;
            resolve(image);
        };
        image.onerror = function () {
            release();
            reject(new Error('Image decode failed'));
        };
        try {
            image.src = url;
        } catch (error) {
            release();
            reject(error);
        }
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
            }).catch(function () {
                if (!urlAPI || !ImageCtor) throw new Error('Image decode failed');
                return fallbackDecode(blob, urlAPI, ImageCtor);
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
            mediaType: 'image',
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

    function loadVideoFrame(originalBlob) {
        if (!documentRef || !urlAPI) return Promise.reject(new Error('Video decoding is unavailable'));
        return new Promise(function (resolve, reject) {
            var video = documentRef.createElement('video');
            var url = urlAPI.createObjectURL(originalBlob);
            var settled = false;
            var timer = setTimeout(function () { finish(reject, new Error('Video poster frame timed out')); }, 8000);

            function cleanup() {
                clearTimeout(timer);
                video.onloadedmetadata = null;
                video.onloadeddata = null;
                video.onseeked = null;
                video.onerror = null;
            }
            function finish(callback, value) {
                if (settled) return;
                settled = true;
                cleanup();
                if (callback === reject) {
                    video.removeAttribute('src');
                    try { video.load(); } catch (ignore) {}
                    urlAPI.revokeObjectURL(url);
                }
                callback(value);
            }
            function ready() {
                if (!video.videoWidth || !video.videoHeight) return;
                var duration = Number.isFinite(video.duration) ? video.duration : 0;
                var posterTime = duration > 0.25 ? Math.min(Math.max(0.1, duration * 0.1), Math.max(0.1, duration - 0.05)) : 0;
                if (posterTime > 0 && Math.abs(video.currentTime - posterTime) > 0.04) {
                    video.onseeked = function () { finish(resolve, { video: video, url: url, duration: duration }); };
                    try { video.currentTime = posterTime; } catch (ignore) { finish(resolve, { video: video, url: url, duration: duration }); }
                } else {
                    finish(resolve, { video: video, url: url, duration: duration });
                }
            }
            video.preload = 'auto';
            video.muted = true;
            video.playsInline = true;
            video.onloadedmetadata = ready;
            video.onloadeddata = ready;
            video.onerror = function () { finish(reject, new Error('Video decode failed')); };
            video.src = url;
            try { video.load(); } catch (ignore) {}
        });
    }

    async function createVideoLayers(originalBlob, maxWorkingDimension) {
        if (!(originalBlob instanceof Blob)) throw new Error('Video source must be a Blob');
        if (!documentRef) throw new Error('A document is required to create video layers');
        var loaded;
        try {
            loaded = await loadVideoFrame(originalBlob);
        } catch (error) {
            // Some WebViews cannot decode every codec inside a supported MP4
            // container (notably HEVC on some desktop Chromium builds). Keep
            // the original untouched and provide a clear poster placeholder;
            // playback can still work on a device with the system codec.
            var fallbackCanvas = documentRef.createElement('canvas');
            fallbackCanvas.width = 640;
            fallbackCanvas.height = 360;
            var fallbackContext = fallbackCanvas.getContext('2d');
            var gradient = fallbackContext.createLinearGradient(0, 0, 640, 360);
            gradient.addColorStop(0, '#242436');
            gradient.addColorStop(1, '#111119');
            fallbackContext.fillStyle = gradient;
            fallbackContext.fillRect(0, 0, 640, 360);
            fallbackContext.fillStyle = 'rgba(255,255,255,.92)';
            fallbackContext.beginPath();
            fallbackContext.moveTo(278, 126);
            fallbackContext.lineTo(278, 234);
            fallbackContext.lineTo(382, 180);
            fallbackContext.closePath();
            fallbackContext.fill();
            fallbackContext.font = '600 24px sans-serif';
            fallbackContext.textAlign = 'center';
            fallbackContext.fillText('VIDEO', 320, 300);
            var fallbackWorking = await canvasBlob(fallbackCanvas, 'image/jpeg', 0.88);
            var fallbackThumbnail = await resizeImage(fallbackCanvas, thumbnailDimension, 'image/webp', 0.82, documentRef);
            fallbackCanvas.width = 1;
            fallbackCanvas.height = 1;
            return {
                mediaType: 'video',
                videoMime: originalBlob.type || 'video/mp4',
                duration: 0,
                posterFallback: true,
                originalBlob: originalBlob,
                workingBlob: fallbackWorking,
                thumbnailBlob: fallbackThumbnail.blob,
                originalWidth: 640,
                originalHeight: 360,
                workingWidth: 640,
                workingHeight: 360,
                thumbnailWidth: fallbackThumbnail.width,
                thumbnailHeight: fallbackThumbnail.height
            };
        }
        try {
            var dimensions = imageDimensions(loaded.video);
            var workingLimit = Math.max(320, Number(maxWorkingDimension) || 1600);
            var working = await resizeImage(loaded.video, workingLimit, 'image/jpeg', 0.9, documentRef);
            var thumbnail = await resizeImage(loaded.video, thumbnailDimension, 'image/webp', 0.82, documentRef);
            return {
                mediaType: 'video',
                videoMime: originalBlob.type || 'video/mp4',
                duration: loaded.duration,
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
        } finally {
            loaded.video.pause();
            loaded.video.removeAttribute('src');
            try { loaded.video.load(); } catch (ignore) {}
            urlAPI.revokeObjectURL(loaded.url);
        }
    }

    function hydratePhoto(photo, layers) {
        Object.assign(photo, layers);
        photo.blob = layers.workingBlob;
        photo.assetRevision = ++revision;
        attachURLs(photo);
        return photo;
    }

    function layerBlob(photo, layer) {
        // Static wall rendering and the crop editor use the generated poster
        // for video assets. The untouched original video remains available to
        // persistence and the lightbox player.
        if (layer === 'original' && photo.mediaType !== 'video') return photo.originalBlob || photo.workingBlob || photo.blob;
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
        createVideoLayers: createVideoLayers,
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
