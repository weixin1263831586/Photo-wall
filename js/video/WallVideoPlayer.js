/**
 * WallVideoPlayer — keeps one hidden, muted, looping <video> element per
 * imported video photo so the wall can paint the clip's live frame into
 * every cell it occupies, looping forever.
 *
 * Elements are created lazily from the photo's original or temporary H.264
 * playback blob. Decoder slots rotate when a project contains many videos.
 * Export keeps the same bounded pool and seeks visible sources on demand.
 */
export function createWallVideoPlayer(options) {
    options = options || {};
    var documentRef = options.document || (typeof document !== 'undefined' ? document : null);
    var urlAPI = options.URL || (typeof URL !== 'undefined' ? URL : null);
    var onActivity = typeof options.onActivity === 'function' ? options.onActivity : null;
    var onDecodeError = typeof options.onDecodeError === 'function' ? options.onDecodeError : null;
    /* Every looping element holds a hardware/software decoder. Bound the
       pool so a wall of many videos keeps the device responsive; cells
       beyond the cap keep their static poster. */
    var maxConcurrent = Math.max(1, Number(options.maxConcurrent) || 6);
    var rotationInterval = Math.max(20, Number(options.rotationInterval) || 12000);
    var seekTimeout = Math.max(250, Number(options.seekTimeout) || 1500);
    var entries = new Map();
    /* Remember the exact source which failed. A later H.264 playback copy may
       use the same photo id and must be allowed to retry immediately. */
    var failed = new Map();
    var container = null;
    var gestureHooked = false;
    var gestureRetryHandler = null;
    var desiredPhotos = [];
    var rotationCursor = 0;
    var rotationTimer = null;
    var exporting = false;
    var manualExportFrames = false;
    var exportLRU = [];

    function notifyActivity() {
        if (onActivity) onActivity();
    }

    function ensureContainer() {
        if (container) return container;
        container = documentRef.createElement('div');
        container.id = 'wall-video-stage';
        container.setAttribute('aria-hidden', 'true');
        container.style.cssText = 'position:fixed;left:0;bottom:0;width:2px;height:2px;' +
            'overflow:hidden;opacity:0;pointer-events:none;';
        documentRef.body.appendChild(container);
        return container;
    }

    function sourceBlob(photo) {
        return photo && (photo.playbackBlob || photo.originalBlob);
    }

    function isPlayableVideoPhoto(photo) {
        var source = sourceBlob(photo);
        return Boolean(photo && photo.mediaType === 'video' && photo.id &&
            source && typeof source.size === 'number' &&
            (photo.posterFallback !== true || photo.playbackBlob));
    }

    function requestPlay(entry) {
        if (manualExportFrames) return;
        var playback;
        try {
            playback = entry.video.play();
        } catch (ignore) {
            return;
        }
        if (!playback || typeof playback.catch !== 'function') return;
        playback.catch(function (error) {
            /* Muted inline playback is permitted everywhere; rejections here
               are usually play()/pause() races. A real autoplay denial is
               retried on the next user gesture. */
            if (error && error.name === 'NotAllowedError') hookGestureRetry();
        });
    }

    function hookGestureRetry() {
        if (gestureHooked || !documentRef || typeof documentRef.addEventListener !== 'function') return;
        gestureHooked = true;
        gestureRetryHandler = function retryAll() {
            entries.forEach(requestPlay);
        };
        documentRef.addEventListener('pointerdown', gestureRetryHandler, { passive: true });
        documentRef.addEventListener('keydown', gestureRetryHandler);
    }

    function handleVisibility() {
        if (!documentRef || typeof documentRef.hidden !== 'boolean') return;
        if (documentRef.hidden) {
            entries.forEach(function (entry) {
                try { entry.video.pause(); } catch (ignore) {}
            });
        } else if (!manualExportFrames) {
            entries.forEach(requestPlay);
            notifyActivity();
        }
    }

    function createEntry(photo) {
        var video = documentRef.createElement('video');
        var source = sourceBlob(photo);
        var entry = {
            video: video,
            url: urlAPI.createObjectURL(source),
            source: source,
            photo: photo,
            ready: false
        };
        video.muted = true;
        video.loop = true;
        if ('playsInline' in video) video.playsInline = true;
        video.setAttribute('playsinline', '');
        video.preload = 'auto';
        video.style.cssText = 'width:2px;height:2px;opacity:0;pointer-events:none;';
        video.addEventListener('loadeddata', function () {
            if (entries.get(photo.id) !== entry) return;
            if (!entry.ready && video.readyState >= 2) {
                entry.ready = true;
                requestPlay(entry);
                notifyActivity();
            }
        });
        video.addEventListener('error', function (event) {
            if (entries.get(photo.id) !== entry) return;
            /* The clip cannot be decoded in this runtime — fall back to the
               static poster permanently instead of retrying every sync(). */
            failed.set(photo.id, entry.source);
            release(photo.id);
            notifyActivity();
            if (onDecodeError) {
                try { onDecodeError(photo, video.error || event || new Error('Video decode failed')); }
                catch (callbackError) { console.warn('视频解码失败回调异常:', callbackError); }
            }
        });
        video.src = entry.url;
        try { video.load(); } catch (ignore) {}
        ensureContainer().appendChild(video);
        requestPlay(entry);
        return entry;
    }

    function release(id) {
        var entry = entries.get(id);
        if (!entry) return;
        entries.delete(id);
        try { entry.video.pause(); } catch (ignore) {}
        entry.video.removeAttribute('src');
        try { entry.video.load(); } catch (ignore) {}
        if (entry.video.parentNode) entry.video.parentNode.removeChild(entry.video);
        if (urlAPI) urlAPI.revokeObjectURL(entry.url);
    }

    function clearRotationTimer() {
        if (rotationTimer) clearTimeout(rotationTimer);
        rotationTimer = null;
    }

    function isFailed(photo) {
        return failed.get(photo.id) === sourceBlob(photo);
    }

    function activate(photos, limit) {
        var active = new Set();
        var list = Array.isArray(photos) ? photos : [];
        var maximum = Number.isFinite(limit) ? Math.max(0, limit) : list.length;
        for (var i = 0; i < list.length && active.size < maximum; i++) {
            var photo = list[i];
            if (!isPlayableVideoPhoto(photo) || isFailed(photo)) continue;
            active.add(photo.id);
            var entry = entries.get(photo.id);
            if (entry && entry.source !== sourceBlob(photo)) {
                release(photo.id);
                entry = null;
            }
            if (entry) {
                entry.photo = photo;
                continue;
            }
            entries.set(photo.id, createEntry(photo));
        }
        Array.from(entries.keys()).forEach(function (id) {
            if (!active.has(id)) release(id);
        });
        notifyActivity();
    }

    function activeWindow() {
        if (desiredPhotos.length <= maxConcurrent) return desiredPhotos.slice();
        var windowPhotos = [];
        for (var index = 0; index < maxConcurrent; index++) {
            windowPhotos.push(desiredPhotos[(rotationCursor + index) % desiredPhotos.length]);
        }
        return windowPhotos;
    }

    function scheduleRotation() {
        clearRotationTimer();
        if (exporting || desiredPhotos.length <= maxConcurrent ||
            (documentRef && documentRef.hidden)) return;
        rotationTimer = setTimeout(function () {
            rotationTimer = null;
            if (exporting || desiredPhotos.length <= maxConcurrent) return;
            rotationCursor = (rotationCursor + maxConcurrent) % desiredPhotos.length;
            activate(activeWindow(), maxConcurrent);
            scheduleRotation();
        }, rotationInterval);
        /* Do not keep Node/unit-test processes alive solely for the decoder
           rotation watchdog. Browser numeric timer ids do not expose unref(). */
        if (rotationTimer && typeof rotationTimer.unref === 'function') rotationTimer.unref();
    }

    function sync(photos) {
        if (!documentRef) return;
        var list = Array.isArray(photos) ? photos : [];
        desiredPhotos = list.filter(isPlayableVideoPhoto);
        if (rotationCursor >= desiredPhotos.length) rotationCursor = 0;
        if (exporting) return;
        activate(activeWindow(), maxConcurrent);
        scheduleRotation();
    }

    function waitForMetadata(entry) {
        if (!entry || entry.video.readyState >= 1) return Promise.resolve(entry);
        return new Promise(function (resolve) {
            var settled = false;
            var timer = setTimeout(finish, seekTimeout);
            function finish() {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(entry);
            }
            entry.video.addEventListener('loadedmetadata', finish, { once: true });
            entry.video.addEventListener('loadeddata', finish, { once: true });
            entry.video.addEventListener('error', finish, { once: true });
        });
    }

    function seekEntry(entry, timeMs) {
        return waitForMetadata(entry).then(function () {
            var video = entry.video;
            try { video.pause(); } catch (ignore) {}
            var duration = Number(video.duration) || Number(entry.photo.duration) || 0;
            if (!(duration > 0)) return;
            var target = Math.max(0, Number(timeMs) || 0) / 1000 % duration;
            if (Math.abs((Number(video.currentTime) || 0) - target) < 0.025 && video.readyState >= 2) return;
            return new Promise(function (resolve) {
                var settled = false;
                var timer = setTimeout(finish, seekTimeout);
                function finish() {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    resolve();
                }
                video.addEventListener('seeked', finish, { once: true });
                video.addEventListener('loadeddata', finish, { once: true });
                try { video.currentTime = target; } catch (ignore) { finish(); }
            });
        });
    }

    /** Keep recently-used export decoders within the same device-safe cap. */
    function touchExportEntry(id) {
        var index = exportLRU.indexOf(id);
        if (index >= 0) exportLRU.splice(index, 1);
        exportLRU.push(id);
    }

    function evictExportEntry(exceptId) {
        while (entries.size >= maxConcurrent) {
            var candidate = exportLRU.shift();
            if (!candidate || candidate === exceptId || !entries.has(candidate)) {
                candidate = Array.from(entries.keys()).find(function (id) { return id !== exceptId; });
            }
            if (!candidate) break;
            release(candidate);
        }
    }

    /**
     * Export never expands to one decoder per imported clip. Android's manual
     * renderer requests a visible clip immediately before drawing it; the LRU
     * can then evict that decoder after its pixels are already on the canvas.
     */
    async function beginExport(photos, options) {
        options = options || {};
        exporting = true;
        manualExportFrames = options.manualFrames === true;
        clearRotationTimer();
        desiredPhotos = (Array.isArray(photos) ? photos : desiredPhotos).filter(isPlayableVideoPhoto);
        exportLRU = [];
        activate(desiredPhotos, maxConcurrent);
        entries.forEach(function (_, id) { touchExportEntry(id); });
        await Promise.all(Array.from(entries.values()).map(waitForMetadata));
        entries.forEach(function (entry) {
            try { entry.video.currentTime = 0; } catch (ignore) {}
            if (manualExportFrames) {
                try { entry.video.pause(); } catch (ignore) {}
            } else {
                requestPlay(entry);
            }
        });
        notifyActivity();
    }

    function prepareFrame(timeMs) {
        if (!manualExportFrames) return Promise.resolve();
        return Promise.all(Array.from(entries.values()).map(function (entry) {
            return seekEntry(entry, timeMs);
        })).then(function () { notifyActivity(); });
    }

    /** Prepare one manual-export source just before the renderer paints it. */
    async function preparePhotoFrame(photo, timeMs) {
        if (!photo || !exporting) return get(photo);
        if (!manualExportFrames) return get(photo);
        if (!isPlayableVideoPhoto(photo) || isFailed(photo)) return null;
        var entry = entries.get(photo.id);
        if (entry && entry.source !== sourceBlob(photo)) {
            release(photo.id);
            entry = null;
        }
        if (!entry) {
            evictExportEntry(photo.id);
            entry = createEntry(photo);
            entries.set(photo.id, entry);
        }
        touchExportEntry(photo.id);
        await seekEntry(entry, timeMs);
        notifyActivity();
        return get(photo);
    }

    function endExport() {
        exporting = false;
        manualExportFrames = false;
        exportLRU = [];
        rotationCursor = 0;
        activate(activeWindow(), maxConcurrent);
        entries.forEach(requestPlay);
        scheduleRotation();
    }

    function retry(photo) {
        if (!photo) return;
        failed.delete(photo.id);
        release(photo.id);
        sync(desiredPhotos.map(function (item) { return item.id === photo.id ? photo : item; }));
    }

    /** Current playable element for a photo, or null until it has a frame. */
    function get(photo) {
        if (!photo) return null;
        var entry = entries.get(photo.id);
        if (!entry) return null;
        if (entry.video.readyState >= 2) {
            /* Loop restarts dip readyState for a single tick; keep the
               loadeddata latch so hasReady() cannot permanently go quiet on
               a looping element that keeps playing. */
            entry.ready = true;
            return entry.video;
        }
        return null;
    }

    function hasReady() {
        var ready = false;
        entries.forEach(function (entry) {
            if (!ready && get(entry.photo)) ready = true;
        });
        return ready;
    }

    function destroy() {
        clearRotationTimer();
        Array.from(entries.keys()).forEach(release);
        failed.clear();
        desiredPhotos = [];
        exportLRU = [];
        if (documentRef && typeof documentRef.removeEventListener === 'function') {
            documentRef.removeEventListener('visibilitychange', handleVisibility);
            if (gestureRetryHandler) {
                documentRef.removeEventListener('pointerdown', gestureRetryHandler);
                documentRef.removeEventListener('keydown', gestureRetryHandler);
            }
        }
        gestureRetryHandler = null;
        gestureHooked = false;
        if (container && container.parentNode) container.parentNode.removeChild(container);
        container = null;
    }

    if (documentRef && typeof documentRef.addEventListener === 'function') {
        documentRef.addEventListener('visibilitychange', handleVisibility);
    }

    return {
        sync: sync,
        get: get,
        hasReady: hasReady,
        maxConcurrent: maxConcurrent,
        release: function (photo) { if (photo) release(photo.id); },
        retry: retry,
        beginExport: beginExport,
        prepareFrame: prepareFrame,
        preparePhotoFrame: preparePhotoFrame,
        endExport: endExport,
        setOnActivity: function (handler) {
            if (typeof handler === 'function') onActivity = handler;
        },
        destroy: destroy,
        stats: function () {
            return { entries: entries.size, failed: failed.size };
        }
    };
}
