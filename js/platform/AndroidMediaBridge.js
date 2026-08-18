function tauriRuntimeAvailable() {
    return typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);
}

export function isAndroidNativeApp() {
    return tauriRuntimeAvailable() &&
        typeof navigator !== 'undefined' &&
        /android/i.test(String(navigator.userAgent || ''));
}

function abortError() {
    var error = new Error('视频导出已取消');
    error.name = 'AbortError';
    return error;
}

function throwIfAborted(signal) {
    if (signal && signal.aborted) throw abortError();
}

async function removeQuietly(filesystem, path) {
    if (!filesystem || !path) return;
    try { await filesystem.remove(path); } catch (_) {}
}

function canvasToJpegBlob(canvas, quality) {
    return new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) {
            if (blob) resolve(blob);
            else reject(new Error('Android frame encode failed'));
        }, 'image/jpeg', quality || 0.9);
    });
}

async function nativeModules() {
    var modules = await Promise.all([
        import('@tauri-apps/api/core'),
        import('@tauri-apps/api/path'),
        import('@tauri-apps/plugin-fs')
    ]);
    return {
        invoke: modules[0].invoke,
        path: modules[1],
        fs: modules[2]
    };
}

function dispatchProgress(detail) {
    if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
    window.dispatchEvent(new CustomEvent('photowall:video-export-progress', { detail: detail }));
}

/**
 * Android WebView cannot reliably decode every MP4/HEVC stream. Ask the
 * platform MediaMetadataRetriever to extract a JPEG poster instead.
 */
export async function extractVideoPosterOnAndroid(blob, options) {
    if (!isAndroidNativeApp() || !(blob instanceof Blob)) return null;
    options = options || {};
    var native = await nativeModules();
    var cacheDir = await native.path.appCacheDir();
    var id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    var inputPath = await native.path.join(cacheDir, 'poster-input-' + id + '.mp4');
    var outputPath = await native.path.join(cacheDir, 'poster-output-' + id + '.jpg');
    try {
        await native.fs.writeFile(inputPath, new Uint8Array(await blob.arrayBuffer()));
        var result = await native.invoke('plugin:native-video|extract_poster', {
            payload: {
                inputPath: inputPath,
                outputPath: outputPath,
                maxDimension: Math.max(320, Math.min(1920, Number(options.maxDimension) || 1280))
            }
        });
        var bytes = await native.fs.readFile(result.outputPath || outputPath);
        if (!bytes || bytes.byteLength < 128) throw new Error('Android poster extractor returned no image');
        return {
            blob: new Blob([bytes], { type: 'image/jpeg' }),
            width: Number(result.width) || 640,
            height: Number(result.height) || 360,
            duration: Math.max(0, Number(result.duration) || 0)
        };
    } finally {
        await removeQuietly(native.fs, inputPath);
        await removeQuietly(native.fs, outputPath);
    }
}

/**
 * Android-native video export.
 *
 * Frames are rendered deterministically in JS and Media3/MediaCodec performs
 * the final H.264/AAC encode. The AbortSignal is honoured both while creating
 * JPEG frames and while the native Transformer is running.
 */
export async function recordTimelineOnAndroid(wall, timeline, options) {
    if (!isAndroidNativeApp()) throw new Error('Android native runtime is unavailable');
    options = options || {};
    var signal = options.signal || null;
    throwIfAborted(signal);

    var native = await nativeModules();
    var cacheDir = await native.path.appCacheDir();
    var id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    var fps = Math.max(8, Math.min(15, Number(options.fps) || 15));
    var frameDuration = 1000 / fps;
    var totalFrames = Math.max(1, Math.ceil(timeline.duration / frameDuration) + 1);
    var scale = Math.max(0.5, Math.min(1, Number(options.scale) || 1));
    var cssWidth = Math.max(2, Math.round(Number(options.width) || wall.cssWidth || 720));
    var cssHeight = Math.max(2, Math.round(Number(options.height) || wall.cssHeight || 1280));
    var pixelWidth = Math.max(2, Math.round(cssWidth * scale));
    var pixelHeight = Math.max(2, Math.round(cssHeight * scale));
    if (pixelWidth % 2) pixelWidth--;
    if (pixelHeight % 2) pixelHeight--;

    var canvas = document.createElement('canvas');
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    var ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Android export canvas is unavailable');
    var sourceFrame = wall.getExportFrame(options.aspectRatio || 'auto');
    var background = options.background === 'transparent' ? '#000000' :
        (options.background || '#000000');
    var framePaths = [];
    var outputPath = await native.path.join(cacheDir, 'android-export-' + id + '.mp4');
    var audioPath = '';
    var onProgress = options.onProgress || function () {};
    var onStatus = options.onStatus || function () {};
    var nativeEncodingStarted = false;

    async function cancelNativeEncoding() {
        if (!nativeEncodingStarted) return;
        try { await native.invoke('plugin:native-video|cancel_export'); } catch (_) {}
    }

    var abortHandler = function () { cancelNativeEncoding(); };
    if (signal) signal.addEventListener('abort', abortHandler, { once: true });

    try {
        onStatus('Android 原生导出：正在生成视频帧…');
        dispatchProgress({ stage: 'frames', percent: 0, current: 0, total: totalFrames });
        for (var frame = 0; frame < totalFrames; frame++) {
            throwIfAborted(signal);
            var time = Math.min(timeline.duration, frame * frameDuration);
            ctx.clearRect(0, 0, pixelWidth, pixelHeight);
            if (typeof wall.renderPlaybackFrameAsync === 'function') {
                await wall.renderPlaybackFrameAsync(ctx, timeline.getFrame(time), {
                    sourceFrame: sourceFrame,
                    background: background
                });
            } else {
                wall.renderPlaybackFrame(ctx, timeline.getFrame(time), {
                    sourceFrame: sourceFrame,
                    background: background
                });
            }
            throwIfAborted(signal);
            var frameBlob = await canvasToJpegBlob(canvas, 0.88);
            var framePath = await native.path.join(
                cacheDir,
                'android-frame-' + id + '-' + String(frame).padStart(5, '0') + '.jpg'
            );
            await native.fs.writeFile(framePath, new Uint8Array(await frameBlob.arrayBuffer()));
            framePaths.push(framePath);
            onProgress(frame + 1, totalFrames);
            dispatchProgress({
                stage: 'frames',
                percent: Math.round((frame + 1) / totalFrames * 82),
                current: frame + 1,
                total: totalFrames
            });
            if ((frame & 7) === 7) await new Promise(function (resolve) { setTimeout(resolve, 0); });
        }

        throwIfAborted(signal);
        var music = options.backgroundMusic;
        var musicBlob = music && (music.originalBlob || music.blob);
        if (musicBlob instanceof Blob) {
            var audioExt = /mpeg/i.test(musicBlob.type) ? 'mp3' :
                /aac/i.test(musicBlob.type) ? 'aac' :
                /mp4/i.test(musicBlob.type) ? 'm4a' : 'wav';
            audioPath = await native.path.join(cacheDir, 'android-audio-' + id + '.' + audioExt);
            await native.fs.writeFile(audioPath, new Uint8Array(await musicBlob.arrayBuffer()));
        }

        throwIfAborted(signal);
        onStatus('Android 原生导出：正在使用 MediaCodec 编码 H.264…');
        dispatchProgress({ stage: 'encoding', percent: 86, indeterminate: true });
        nativeEncodingStarted = true;
        var result = await native.invoke('plugin:native-video|transcode_frames', {
            payload: {
                framePaths: framePaths,
                outputPath: outputPath,
                fps: fps,
                audioPath: audioPath || null,
                duration: timeline.duration / 1000,
                volume: music ? music.volume : 0.7,
                startTime: music ? music.startTime : 0,
                endTime: music ? music.endTime : 0,
                loopAudio: music ? music.loop !== false : false,
                fadeIn: music ? music.fadeIn : 0,
                fadeOut: music ? music.fadeOut : 0
            }
        });
        nativeEncodingStarted = false;
        throwIfAborted(signal);
        var bytes = await native.fs.readFile(result.outputPath || outputPath);
        if (!bytes || bytes.byteLength < 512) throw new Error('Android 原生编码器没有生成有效视频');
        dispatchProgress({ stage: 'complete', percent: 100, current: totalFrames, total: totalFrames });
        return new Blob([bytes], { type: 'video/mp4' });
    } catch (error) {
        if (signal && signal.aborted) throw abortError();
        throw error;
    } finally {
        if (signal) signal.removeEventListener('abort', abortHandler);
        if (signal && signal.aborted) await cancelNativeEncoding();
        canvas.width = 1;
        canvas.height = 1;
        for (var i = 0; i < framePaths.length; i++) {
            await removeQuietly(native.fs, framePaths[i]);
        }
        await removeQuietly(native.fs, audioPath);
        await removeQuietly(native.fs, outputPath);
    }
}
