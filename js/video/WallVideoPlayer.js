/**
 * WallVideoPlayer — keeps one hidden, muted, looping <video> element per
 * imported video photo so the wall can paint the clip's live frame into
 * every cell it occupies, looping forever.
 *
 * Elements are created lazily from the photo's original or temporary H.264
 * playback blob. Decoder slots rotate when a project contains many videos;
 * export temporarily includes every source for complete, time-accurate frames.
 */
export function createWallVideoPlayer(options) {
    options = options || {};
    var documentRef = options.document || (typeof document !== 'undefined' ? document : null);
    var urlAPI = options.URL || (typeof URL !== 'undefined' ? URL : null);
    var onActivity = typeof options.onActivity === 'function' ? options.onActivity : null;
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
    var desiredPhotos = [];
    var rotationCursor = 0;
    var rotationTimer = null;
    var exporting = false;
    var manualExportFrames = false;

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
        function retryAll() {
            entries.forEach(requestPlay);
        }
        documentRef.addEventListener('pointerdown', retryAll, { passive: true });
        documentRef.addEventListener('keydown', retryAll);
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
        video.addEventListener('error', function () {
            if (entries.get(photo.id) !== entry) return;
            /* The clip cannot be decoded in this runtime — fall back to the
               static poster permanently instead of retrying every sync(). */
            failed.set(photo.id, entry.source);
            release(photo.id);
            notifyActivity();
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

    /**
     * Video export temporarily expands the decoder pool so every imported
     * video can contribute frames. Android uses manual seeking because its
     * JPEG sequence is rendered faster than wall-clock playback.
     */
    async function beginExport(photos, options) {
        options = options || {};
        exporting = true;
        manualExportFrames = options.manualFrames === true;
        clearRotationTimer();
        desiredPhotos = (Array.isArray(photos) ? photos : desiredPhotos).filter(isPlayableVideoPhoto);
        activate(desiredPhotos, desiredPhotos.length);
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

    function endExport() {
        exporting = false;
        manualExportFrames = false;
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
