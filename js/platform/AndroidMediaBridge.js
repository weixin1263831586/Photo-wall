import { writeBlobToFile, readFileAsBlob } from './BlobFileWriter.js';

function tauriRuntimeAvailable() {
    return typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);
}

export function isAndroidNativeApp() {
    return tauriRuntimeAvailable() &&
        typeof navigator !== 'undefined' &&
        /android/i.test(String(navigator.userAgent || ''));
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

/* Keep the cache-file extension aligned with the container: some OEM
   MediaExtractor builds pick demuxers by extension before probing. */
function videoExtension(blob, name) {
    var match = String(name || '').toLowerCase().match(/\.(mp4|webm|mov|m4v|mkv|avi|3gp|mpeg|mpg)$/);
    if (match) return match[1];
    var type = String((blob && blob.type) || '').toLowerCase();
    if (type.indexOf('quicktime') >= 0) return 'mov';
    if (type.indexOf('x-m4v') >= 0) return 'm4v';
    if (type.indexOf('webm') >= 0) return 'webm';
    if (type.indexOf('matroska') >= 0) return 'mkv';
    if (type.indexOf('msvideo') >= 0) return 'avi';
    if (type.indexOf('3gpp') >= 0) return '3gp';
    if (type.indexOf('mpeg') >= 0) return 'mpeg';
    return 'mp4';
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
    var inputPath = await native.path.join(cacheDir, 'poster-input-' + id + '.' + videoExtension(blob, options.name));
    var outputPath = await native.path.join(cacheDir, 'poster-output-' + id + '.jpg');
    try {
        await writeBlobToFile(blob, native.fs, inputPath);
        var result = await native.invoke('plugin:native-video|extract_poster', {
            payload: {
                inputPath: inputPath,
                outputPath: outputPath,
                maxDimension: Math.max(320, Math.min(1920, Number(options.maxDimension) || 1280)),
                timeFraction: Math.max(0, Math.min(0.95, Number(options.timeFraction) || 0.1))
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
 * Re-encode an imported video with the platform Media3/MediaCodec pipeline so
 * the WebView can play codecs it cannot decode itself (HEVC in MP4/MOV etc.).
 * The result is a temporary H.264/AAC playback copy; the original stays intact.
 */
export async function transcodeVideoForAndroidPlayback(blob, options) {
    if (!isAndroidNativeApp() || !(blob instanceof Blob)) {
        throw new Error('Android native playback transcoding is unavailable');
    }
    options = options || {};
    var native = await nativeModules();
    var capabilities = await native.invoke('plugin:native-video|capabilities');
    if (!capabilities || !capabilities.available) {
        throw new Error('当前设备没有可用的硬件转码器');
    }
    var cacheDir = await native.path.appCacheDir();
    var id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    var extension = videoExtension(blob, options.name);
    var inputPath = await native.path.join(cacheDir, 'play-input-' + id + '.' + extension);
    var outputPath = await native.path.join(cacheDir, 'play-copy-' + id + '.mp4');

    async function attempt(keepAudio) {
        var timeoutId;
        var invokePromise = native.invoke('plugin:native-video|transcode', {
            payload: {
                inputPath: inputPath,
                outputPath: outputPath,
                audioPath: null,
                duration: 0,
                volume: 1,
                startTime: 0,
                endTime: 0,
                loopAudio: false,
                fadeIn: 0,
                fadeOut: 0,
                keepAudio: keepAudio
            }
        });
        /* If the watchdog fires first and we fall back, the native job keeps
           running; swallow its eventual rejection so it is not captured as an
           unhandledrejection crash report. */
        invokePromise.catch(function () {});
        try {
            return await Promise.race([
                invokePromise,
                new Promise(function (_, reject) {
                    timeoutId = setTimeout(function () {
                        reject(new Error('设备转码超时，请重试或使用系统播放器'));
                    }, 300000);
                })
            ]);
        } finally {
            clearTimeout(timeoutId);
        }
    }

    try {
        if (options.onStatus) options.onStatus({ phase: 'native', message: '正在使用设备硬件转码…' });
        await writeBlobToFile(blob, native.fs, inputPath);
        var result;
        try {
            result = await attempt(true);
        } catch (audioError) {
            /* Some recordings carry audio codecs the device encoder chain
               rejects (e.g. AC-3/EAC-3). A silent H.264 copy still plays. */
            console.warn('Android 带音轨转码失败，改为无声副本:', audioError);
            if (options.onStatus) options.onStatus({ phase: 'native', message: '正在转码无声副本…' });
            result = await attempt(false);
        }
        var playbackBlob = await readFileAsBlob(native.fs, result.outputPath || outputPath, 'video/mp4');
        if (!playbackBlob || playbackBlob.size < 512) throw new Error('设备转码器没有生成可播放的视频');
        if (options.onStatus) options.onStatus({ phase: 'complete', progress: 1, message: '转码完成，正在播放…' });
        return playbackBlob;
    } finally {
        await removeQuietly(native.fs, inputPath);
        await removeQuietly(native.fs, outputPath);
    }
}

/**
 * Android-native video export.
 *
 * Do not depend on HTMLCanvasElement.captureStream()/MediaRecorder: those APIs
 * are missing or incomplete on a number of Android System WebView builds.
 * Render deterministic JPEG frames in JS, then let Media3 Transformer encode
 * the image sequence to H.264/AAC.
 */
export async function recordTimelineOnAndroid(wall, timeline, options) {
    if (!isAndroidNativeApp()) throw new Error('Android native runtime is unavailable');
    options = options || {};
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
    /* H.264 encoders are much more portable with even dimensions. */
    if (pixelWidth % 2) pixelWidth--;
    if (pixelHeight % 2) pixelHeight--;

    var canvas = document.createElement('canvas');
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    var ctx = canvas.getContext('2d', { alpha: false });
    var sourceFrame = wall.getExportFrame(options.aspectRatio || 'auto');
    var background = options.background === 'transparent' ? '#000000' :
        (options.background || '#000000');
    var framePaths = [];
    var outputPath = await native.path.join(cacheDir, 'android-export-' + id + '.mp4');
    var audioPath = '';
    var onProgress = options.onProgress || function () {};
    var onStatus = options.onStatus || function () {};
    var signal = options.signal || null;
    var videoPlayer = wall.videoPlayer;
    var nativeEncodingStarted = false;

    function throwIfAborted() {
        if (!signal || !signal.aborted) return;
        var error = new Error('视频导出已取消');
        error.name = 'AbortError';
        throw error;
    }

    function cancelNativeEncoding() {
        if (!nativeEncodingStarted) return;
        native.invoke('plugin:native-video|cancel_export').catch(function () {});
    }

    try {
        throwIfAborted();
        if (videoPlayer && typeof videoPlayer.beginExport === 'function') {
            onStatus('Android 原生导出：正在准备视频素材…');
            await videoPlayer.beginExport(wall.photos, { manualFrames: true });
        }
        onStatus('Android 原生导出：正在生成视频帧…');
        for (var frame = 0; frame < totalFrames; frame++) {
            throwIfAborted();
            var time = Math.min(timeline.duration, frame * frameDuration);
            if (videoPlayer && typeof videoPlayer.prepareFrame === 'function') {
                await videoPlayer.prepareFrame(time);
            }
            throwIfAborted();
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
            var frameBlob = await canvasToJpegBlob(canvas, 0.88);
            var framePath = await native.path.join(
                cacheDir,
                'android-frame-' + id + '-' + String(frame).padStart(5, '0') + '.jpg'
            );
            await writeBlobToFile(frameBlob, native.fs, framePath);
            framePaths.push(framePath);
            onProgress(frame + 1, totalFrames);
            /* Yield periodically so Android WebView can process input/UI events. */
            if ((frame & 7) === 7) await new Promise(function (resolve) { setTimeout(resolve, 0); });
        }

        throwIfAborted();
        var music = options.backgroundMusic;
        var musicBlob = music && (music.originalBlob || music.blob);
        if (musicBlob instanceof Blob) {
            var audioExt = /mpeg/i.test(musicBlob.type) ? 'mp3' :
                /aac/i.test(musicBlob.type) ? 'aac' :
                /mp4/i.test(musicBlob.type) ? 'm4a' : 'wav';
            audioPath = await native.path.join(cacheDir, 'android-audio-' + id + '.' + audioExt);
            await writeBlobToFile(musicBlob, native.fs, audioPath);
        }

        onStatus('Android 原生导出：正在使用 MediaCodec 编码 H.264…');
        nativeEncodingStarted = true;
        if (signal) signal.addEventListener('abort', cancelNativeEncoding, { once: true });
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
        throwIfAborted();
        var exportBlob = await readFileAsBlob(native.fs, result.outputPath || outputPath, 'video/mp4');
        if (!exportBlob || exportBlob.size < 512) throw new Error('Android 原生编码器没有生成有效视频');
        return exportBlob;
    } finally {
        if (signal) signal.removeEventListener('abort', cancelNativeEncoding);
        if (videoPlayer && typeof videoPlayer.endExport === 'function') videoPlayer.endExport();
        canvas.width = 1;
        canvas.height = 1;
        for (var i = 0; i < framePaths.length; i++) {
            await removeQuietly(native.fs, framePaths[i]);
        }
        await removeQuietly(native.fs, audioPath);
        await removeQuietly(native.fs, outputPath);
    }
}
