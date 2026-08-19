import { extractVideoPosterOnAndroid, isAndroidNativeApp } from '../platform/AndroidMediaBridge.js';

/* An unrendered video decoder surface reads back as solid black. Frames whose
   brightest sampled pixel stays under this luminance are treated as blank and
   get re-captured before they become the poster. */
var BLANK_FRAME_LUMINANCE = 12;

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
    if (!context) throw new Error('Image resize canvas is unavailable');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, width, height);
    try {
        var blob = await canvasBlob(canvas, mime, quality);
        return { blob: blob, width: width, height: height };
    } finally {
        canvas.width = 1;
        canvas.height = 1;
    }
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

function createFallbackVideoPoster(documentRef) {
    var canvas = documentRef.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    var context = canvas.getContext('2d');
    if (!context) throw new Error('Video fallback canvas is unavailable');
    var gradient = context.createLinearGradient(0, 0, 640, 360);
    gradient.addColorStop(0, '#242436');
    gradient.addColorStop(1, '#111119');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 640, 360);
    context.fillStyle = 'rgba(255,255,255,.92)';
    context.beginPath();
    context.moveTo(278, 126);
    context.lineTo(278, 234);
    context.lineTo(382, 180);
    context.closePath();
    context.fill();
    context.font = '600 24px sans-serif';
    context.textAlign = 'center';
    context.fillText('VIDEO', 320, 300);
    return canvas;
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
        // Android System WebView has device-specific createImageBitmap failures
        // even for images that <img> can decode. Prefer the DOM decoder there.
        if (isAndroidNativeApp() && urlAPI && ImageCtor) {
            return fallbackDecode(blob, urlAPI, ImageCtor);
        }
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
    var thumbnailCache = createBitmapLRU({
        maxEntries: options.maxThumbnailEntries || 320,
        maxPixels: options.maxThumbnailPixels || 32000000,
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
        var workingBlob = photo.workingBlob || photo.blob || photo.originalBlob;
        var thumbnailBlob = photo.thumbnailBlob || workingBlob;
        var urls = {
            working: urlAPI.createObjectURL(workingBlob),
            thumbnail: urlAPI.createObjectURL(thumbnailBlob)
        };
        urlsByPhoto.set(photo.id, urls);
        photo.src = urls.working;
        photo.workingSrc = urls.working;
        photo.thumbnailSrc = urls.thumbnail;
        photo.assetLoadError = false;
        return photo;
    }

    async function createLayers(originalBlob, maxWorkingDimension) {
        if (!(originalBlob instanceof Blob)) throw new Error('Photo source must be a Blob');
        if (!documentRef) throw new Error('A document is required to create photo layers');
        var source = await decode(originalBlob);
        try {
            var dimensions = imageDimensions(source);
            var mime = /^image\/(jpeg|png|webp)$/i.test(originalBlob.type) ? originalBlob.type : 'image/jpeg';
            var workingLimit = Math.max(320, Number(maxWorkingDimension) || 1600);
            var working = Math.max(dimensions.width, dimensions.height) <= workingLimit ?
                { blob: originalBlob, width: dimensions.width, height: dimensions.height } :
                await resizeImage(source, workingLimit, mime, mime === 'image/png' ? undefined : 0.9, documentRef);
            var thumbnail = Math.max(dimensions.width, dimensions.height) <= thumbnailDimension ?
                { blob: originalBlob, width: dimensions.width, height: dimensions.height } :
                await resizeImage(source, thumbnailDimension, 'image/webp', 0.82, documentRef);
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
        } finally {
            closeBitmap(source);
        }
    }

    function frameBrightness(image) {
        /* Sample a tiny downscaled copy of the current frame. Any real content
           produces at least one brighter pixel; a surface the decoder has not
           rendered yet is uniformly black. */
        try {
            var dims = imageDimensions(image);
            var canvas = documentRef.createElement('canvas');
            var width = 48;
            var height = Math.max(1, Math.round(width * dims.height / Math.max(1, dims.width)));
            canvas.width = width;
            canvas.height = height;
            var context = canvas.getContext('2d', { willReadFrequently: true });
            if (!context) return 255;
            context.drawImage(image, 0, 0, width, height);
            var data = context.getImageData(0, 0, width, height).data;
            var brightest = 0;
            for (var i = 0; i < data.length; i += 4) {
                brightest = Math.max(brightest,
                    0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
                if (brightest >= BLANK_FRAME_LUMINANCE) break;
            }
            canvas.width = 1;
            canvas.height = 1;
            return brightest;
        } catch (ignore) {
            /* Read-back unavailable (tainted canvas, missing context): assume
               the frame is usable instead of failing a working import. */
            return 255;
        }
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

    async function layersFromPosterBlob(originalBlob, posterBlob, posterInfo, maxWorkingDimension) {
        var source = await decode(posterBlob);
        try {
            var posterBlank = frameBrightness(source) < BLANK_FRAME_LUMINANCE;
            var dimensions = imageDimensions(source);
            var workingLimit = Math.max(320, Number(maxWorkingDimension) || 1600);
            var working = Math.max(dimensions.width, dimensions.height) <= workingLimit ?
                { blob: posterBlob, width: dimensions.width, height: dimensions.height } :
                await resizeImage(source, workingLimit, 'image/jpeg', 0.9, documentRef);
            var thumbnail = Math.max(dimensions.width, dimensions.height) <= thumbnailDimension ?
                { blob: posterBlob, width: dimensions.width, height: dimensions.height } :
                await resizeImage(source, thumbnailDimension, 'image/webp', 0.82, documentRef);
            return {
                mediaType: 'video',
                videoMime: originalBlob.type || 'video/mp4',
                duration: Math.max(0, Number(posterInfo && posterInfo.duration) || 0),
                posterFallback: false,
                nativePoster: true,
                posterBlank: posterBlank,
                originalBlob: originalBlob,
                workingBlob: working.blob,
                thumbnailBlob: thumbnail.blob,
                originalWidth: Number(posterInfo && posterInfo.width) || dimensions.width,
                originalHeight: Number(posterInfo && posterInfo.height) || dimensions.height,
                workingWidth: working.width,
                workingHeight: working.height,
                thumbnailWidth: thumbnail.width,
                thumbnailHeight: thumbnail.height
            };
        } finally {
            closeBitmap(source);
        }
    }

    async function fallbackVideoLayers(originalBlob) {
        var fallbackCanvas = createFallbackVideoPoster(documentRef);
        try {
            var fallbackWorking = await canvasBlob(fallbackCanvas, 'image/jpeg', 0.88);
            var fallbackThumbnail = await resizeImage(fallbackCanvas, thumbnailDimension, 'image/webp', 0.82, documentRef);
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
        } finally {
            fallbackCanvas.width = 1;
            fallbackCanvas.height = 1;
        }
    }

    /* Extract a poster through the platform MediaMetadataRetriever. The first
       attempt samples near the start of the clip; if that frame is blank (a
       dark scene or another unrendered surface), retry at the middle. The
       first non-blank poster wins; an all-blank video keeps its first poster
       instead of falling through to the generic tile. */
    async function androidPosterLayers(originalBlob, maxWorkingDimension) {
        var fractions = [0.1, 0.5];
        var blankLayers = null;
        for (var i = 0; i < fractions.length; i++) {
            try {
                var poster = await extractVideoPosterOnAndroid(originalBlob, {
                    maxDimension: Math.max(640, Number(maxWorkingDimension) || 1600),
                    timeFraction: fractions[i]
                });
                if (!poster || !(poster.blob instanceof Blob)) continue;
                var layers = await layersFromPosterBlob(
                    originalBlob,
                    poster.blob,
                    poster,
                    maxWorkingDimension
                );
                if (!layers.posterBlank) return layers;
                if (!blankLayers) blankLayers = layers;
            } catch (nativeError) {
                console.warn('Android 原生视频封面提取失败:', nativeError);
            }
        }
        return blankLayers;
    }

    function discardLoadedVideo(loaded) {
        loaded.video.pause();
        loaded.video.removeAttribute('src');
        try { loaded.video.load(); } catch (ignore) {}
        urlAPI.revokeObjectURL(loaded.url);
    }

    function seekVideoTo(video, time, timeout) {
        return new Promise(function (resolve) {
            var settled = false;
            var timer = setTimeout(finish, timeout);
            function finish() {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                video.onseeked = null;
                resolve();
            }
            video.onseeked = finish;
            try { video.currentTime = time; } catch (ignore) { finish(); }
        });
    }

    async function createVideoLayers(originalBlob, maxWorkingDimension) {
        if (!(originalBlob instanceof Blob)) throw new Error('Video source must be a Blob');
        if (!documentRef) throw new Error('A document is required to create video layers');
        var loaded;
        try {
            loaded = await loadVideoFrame(originalBlob);
        } catch (webVideoError) {
            // Android system codecs often support streams that WebView cannot
            // decode (for example HEVC in MP4/MOV). Ask the native retriever
            // before falling back to a generic VIDEO tile.
            if (isAndroidNativeApp()) {
                var nativeLayers = await androidPosterLayers(originalBlob, maxWorkingDimension);
                if (nativeLayers) return nativeLayers;
            }
            return fallbackVideoLayers(originalBlob);
        }

        try {
            /* Some WebView/OMX combinations report a successful seek before the
               decoded frame reaches the video surface, so every poster captured
               with drawImage() comes out solid black. Detect the blank frame,
               re-seek to the middle of the clip and give the decoder a beat to
               render. If it stays black on Android, hand the video to the
               native retriever, whose decoder is not affected by the race. */
            if (frameBrightness(loaded.video) < BLANK_FRAME_LUMINANCE && loaded.duration > 0.4) {
                await seekVideoTo(loaded.video,
                    Math.min(loaded.duration * 0.5, loaded.duration - 0.05), 3000);
                await new Promise(function (resolve) { setTimeout(resolve, 120); });
                if (frameBrightness(loaded.video) < BLANK_FRAME_LUMINANCE && isAndroidNativeApp()) {
                    var rescued = await androidPosterLayers(originalBlob, maxWorkingDimension);
                    if (rescued) {
                        discardLoadedVideo(loaded);
                        loaded = null;
                        return rescued;
                    }
                }
            }

            var dimensions = imageDimensions(loaded.video);
            var workingLimit = Math.max(320, Number(maxWorkingDimension) || 1600);
            var working = await resizeImage(loaded.video, workingLimit, 'image/jpeg', 0.9, documentRef);
            var thumbnail = await resizeImage(loaded.video, thumbnailDimension, 'image/webp', 0.82, documentRef);
            return {
                mediaType: 'video',
                videoMime: originalBlob.type || 'video/mp4',
                duration: loaded.duration,
                posterFallback: false,
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
            if (loaded) discardLoadedVideo(loaded);
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
        if (layer === 'original' && photo.mediaType !== 'video') {
            return photo.originalBlob || photo.workingBlob || photo.blob;
        }
        if (layer === 'thumbnail') {
            return photo.thumbnailBlob || photo.workingBlob || photo.blob || photo.originalBlob;
        }
        return photo.workingBlob || photo.blob || photo.originalBlob;
    }

    function cacheKey(photo, layer) {
        return photo.id + ':' + (photo.assetRevision || 0) + ':' + layer;
    }

    function cacheForLayer(layer) {
        if (layer === 'original') return originalCache;
        if (layer === 'thumbnail') return thumbnailCache;
        return workingCache;
    }

    function normalizeLayer(layer) {
        if (layer === 'original' || layer === 'thumbnail') return layer;
        return 'working';
    }

    function getBitmap(photo, layer) {
        layer = normalizeLayer(layer);
        var blob = layerBlob(photo, layer);
        if (!(blob instanceof Blob)) return Promise.reject(new Error('Photo layer is unavailable'));
        return cacheForLayer(layer).get(cacheKey(photo, layer), blob).then(function (bitmap) {
            photo.assetLoadError = false;
            return bitmap;
        }).catch(function (error) {
            photo.assetLoadError = true;
            throw error;
        });
    }

    function peekBitmap(photo, layer) {
        layer = normalizeLayer(layer);
        return cacheForLayer(layer).peek(cacheKey(photo, layer));
    }

    function retryPhoto(photo) {
        if (!photo) return Promise.reject(new Error('Photo is unavailable'));
        workingCache.removePrefix(photo.id + ':');
        thumbnailCache.removePrefix(photo.id + ':');
        originalCache.removePrefix(photo.id + ':');
        releaseElement(photo);
        attachURLs(photo);
        return getBitmap(photo, 'working').catch(function () {
            return getBitmap(photo, 'thumbnail');
        });
    }

    function releasePhoto(photo) {
        if (!photo) return;
        revokePhotoURLs(photo.id);
        workingCache.removePrefix(photo.id + ':');
        thumbnailCache.removePrefix(photo.id + ':');
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
        thumbnailCache.clear();
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
        retryPhoto: retryPhoto,
        releaseElement: releaseElement,
        releasePhoto: releasePhoto,
        destroy: destroy,
        stats: function () {
            return {
                working: workingCache.stats(),
                thumbnail: thumbnailCache.stats(),
                original: originalCache.stats(),
                urls: urlsByPhoto.size
            };
        }
    };
}
