/**
 * VideoRecorder — drives a PlaybackTimeline and records the canvas to a
 * WebM video via MediaRecorder / canvas.captureStream.
 *
 * For MP4 output, the resulting WebM can be piped through the existing
 * BrowserVideoTranscoder (ffmpeg.wasm).
 */

import { isNativeApp } from '../platform/NativeFileService.js';
import { isAndroidNativeApp, recordTimelineOnAndroid } from '../platform/AndroidMediaBridge.js';

var WEBM_MIME_CANDIDATES = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm'
];

var NATIVE_MP4_MIME_CANDIDATES = [
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4;codecs=avc1',
    'video/mp4'
];

var activeAbortSignal = null;

export function setVideoExportAbortSignal(signal) {
    activeAbortSignal = signal || null;
}

function currentSignal(options) {
    var earlySignal = typeof window !== 'undefined' ? window.__PHOTO_WALL_EXPORT_ABORT_SIGNAL__ : null;
    return (options && options.signal) || activeAbortSignal || earlySignal || null;
}

function abortError() {
    var error = new Error('视频导出已取消');
    error.name = 'AbortError';
    return error;
}

function throwIfAborted(signal) {
    if (signal && signal.aborted) throw abortError();
}

function dispatchExportEvent(name, detail) {
    if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
    window.dispatchEvent(new CustomEvent('photowall:video-export-' + name, { detail: detail || {} }));
}

/**
 * Pick the best supported mimeType. When format is 'webm', only WebM
 * candidates are considered so the recorded stream is container-compatible.
 */
export function pickVideoMimeType(format) {
    if (isAndroidNativeApp()) return format === 'webm' ? '' : 'video/mp4';
    if (typeof MediaRecorder === 'undefined') return '';
    var nativeApp = isNativeApp();
    if (format === 'webm') return WEBM_MIME_CANDIDATES.find(function (candidate) {
        try { return MediaRecorder.isTypeSupported(candidate); } catch (_) { return false; }
    }) || '';
    var candidates = nativeApp ? NATIVE_MP4_MIME_CANDIDATES.concat(WEBM_MIME_CANDIDATES) : WEBM_MIME_CANDIDATES;
    return candidates.find(function (candidate) {
        try { return MediaRecorder.isTypeSupported(candidate); } catch (_) { return false; }
    }) || '';
}

/** Record a timeline-driven animation from a PhotoWall instance. */
export async function recordTimelineCanvas(wall, timeline, options) {
    options = options || {};
    var cssWidth = Math.round(options.width || wall.cssWidth || 1080);
    var cssHeight = Math.round(options.height || wall.cssHeight || 1920);
    var fps = Math.max(10, Math.min(60, Number(options.fps) || 30));
    var format = options.format === 'mp4' ? 'mp4' : 'webm';
    var scale = Math.max(0.5, Number(options.scale) || 1);
    var onProgress = options.onProgress || function () {};
    var onStatus = options.onStatus || function () {};

    /* Android APKs use Media3/MediaCodec directly. Android System WebView
       frequently exposes MediaRecorder without a working canvas recorder (or
       exposes no compatible MIME at all), so do not gate APK export on it. */
    if (isAndroidNativeApp()) {
        return recordTimelineOnAndroid(wall, timeline, options);
    }

    if (typeof MediaRecorder === 'undefined') {
        throw new Error('当前浏览器不支持视频录制（MediaRecorder 不可用）');
    }

    var mimeType = pickVideoMimeType(format);
    if (!mimeType) throw new Error('当前浏览器不支持 WebM 视频录制');

    /* Create an offscreen export canvas. */
    var exportCanvas = document.createElement('canvas');
    var exportCtx = exportCanvas.getContext('2d');
    var pixelWidth = Math.round(cssWidth * scale);
    var pixelHeight = Math.round(cssHeight * scale);
    exportCanvas.width = pixelWidth;
    exportCanvas.height = pixelHeight;

    /* A zero-rate stream lets Chromium capture exactly the frames we request.
       Browsers without requestFrame fall back to a paced fixed-rate stream. */
    var stream = exportCanvas.captureStream(0);
    var videoTrack = stream.getVideoTracks()[0];
    var canRequestFrame = videoTrack && typeof videoTrack.requestFrame === 'function';
    if (!canRequestFrame) {
        stream.getTracks().forEach(function (track) { track.stop(); });
        stream = exportCanvas.captureStream(fps);
        videoTrack = stream.getVideoTracks()[0];
    }
    var recorderOptions = { mimeType: mimeType, videoBitsPerSecond: 8_000_000 };
    var recorder;
    try {
        recorder = new MediaRecorder(stream, recorderOptions);
    } catch (_) {
        recorder = new MediaRecorder(stream);
    }

    var chunks = [];
    var recorderError = null;
    recorder.ondataavailable = function (event) {
        if (event.data && event.data.size > 0) chunks.push(event.data);
    };
    /* Observe failures from the very first frame: an error surfaced only at
       stop() would surface as an unrelated InvalidStateError instead. */
    recorder.onerror = function (event) {
        recorderError = (event && event.error) || new Error('视频录制失败');
    };

    var frameDuration = 1000 / fps;
    var totalFrames = Math.ceil(timeline.duration / frameDuration) + 1;
    if (totalFrames < 1) totalFrames = 1;

    onStatus('正在渲染视频…');

    var now = typeof performance !== 'undefined' && performance.now ?
        function () { return performance.now(); } : function () { return Date.now(); };
    var startedAt = now();

    async function waitUntil(target) {
        var remaining = target - now();
        if (remaining > 10) {
            await new Promise(function (resolve) { setTimeout(resolve, Math.max(0, remaining - 4)); });
        }
        while (now() < target) {
            await new Promise(function (resolve) {
                if (typeof requestAnimationFrame === 'function') requestAnimationFrame(resolve);
                else setTimeout(resolve, 1);
            });
        }
    }

    /* Let the compositor commit the canvas between frames. requestFrame()
       captures the canvas at the next commit; rendering the following frame
       in the same tick coalesces both requests into the newest state, which
       collapses the export to (near-)static video once per-frame rendering
       falls behind the encoder on real devices. */
    async function waitForCommit() {
        await new Promise(function (resolve) {
            if (typeof requestAnimationFrame === 'function') requestAnimationFrame(resolve);
            else setTimeout(resolve, 16);
        });
        await new Promise(function (resolve) {
            if (typeof requestAnimationFrame === 'function') requestAnimationFrame(resolve);
            else setTimeout(resolve, 1);
        });
    }

    /* Compute the export frame layout once — it doesn't change between frames. */
    var sourceFrame = wall.getExportFrame(options.aspectRatio || 'auto');
    var background = options.background || 'transparent';

    try {
        var recordingStartedAt = now();
        recorder.start();
        /* MediaRecorder timestamps frames in wall-clock time, so rendering is
           paced to the selected FPS instead of running one frame per display RAF. */
        for (var frame = 0; frame < totalFrames; frame++) {
            await waitUntil(startedAt + frame * frameDuration);
            var time = Math.min(timeline.duration, frame * frameDuration);
            var playbackFrame = timeline.getFrame(time);

            exportCtx.clearRect(0, 0, pixelWidth, pixelHeight);
            if (typeof wall.renderPlaybackFrameAsync === 'function') {
                await wall.renderPlaybackFrameAsync(exportCtx, playbackFrame, {
                    sourceFrame: sourceFrame,
                    background: background
                });
            } else {
                wall.renderPlaybackFrame(exportCtx, playbackFrame, {
                    sourceFrame: sourceFrame,
                    background: background
                });
            }
            if (canRequestFrame) {
                videoTrack.requestFrame();
                await waitForCommit();
            }

            onProgress(frame + 1, totalFrames);
            if (recorderError) throw recorderError;
        }

        /* Render one final frame to ensure the last state is captured. */
        if (typeof wall.renderPlaybackFrameAsync === 'function') {
            await wall.renderPlaybackFrameAsync(exportCtx, timeline.getFrame(timeline.duration), {
                sourceFrame: sourceFrame,
                background: background
            });
        } else {
            wall.renderPlaybackFrame(exportCtx, timeline.getFrame(timeline.duration), {
                sourceFrame: sourceFrame,
                background: background
            });
        }
        if (canRequestFrame) {
            videoTrack.requestFrame();
            await waitForCommit();
        }

        await new Promise(function (resolve) { setTimeout(resolve, frameDuration); });

        onStatus('正在保存视频…');
        if (recorderError) throw recorderError;
        var stopPromise = new Promise(function (resolve, reject) {
            recorder.onstop = resolve;
            recorder.onerror = function (e) { reject(e.error || new Error('视频录制失败')); };
        });
        recorder.stop();
        await stopPromise;
        /* Slow devices render slower than real time; the recorded stream is
           then longer than the nominal timeline. Downstream muxing trims to
           the provided duration, so report what was actually captured. */
        var recordedDuration = Math.max(timeline.duration, now() - recordingStartedAt);
    } finally {
        /* Ensure stream tracks are always cleaned up, even on error. */
        stream.getTracks().forEach(function (track) { track.stop(); });
        if (recorder.state === 'recording') {
            try { recorder.stop(); } catch (_) {}
        }
    }

    var recordedType = String(recorder.mimeType || mimeType || 'video/webm').split(';')[0];
    var webmBlob = new Blob(chunks, { type: recordedType });
    if (webmBlob.size < 512) throw new Error('视频录制没有生成有效画面');

    if (format === 'mp4') {
        onStatus('正在转换为 MP4…');
        var transcoder = await import('./NativeVideoTranscoder.js');
        var mp4Blob = await transcoder.transcodeVideoForPlatform(webmBlob, {
            backgroundMusic: options.backgroundMusic,
            duration: recordedDuration / 1000,
            /* pickVideoMimeType already prefers H.264 MP4 inside the native
               app; skip a redundant re-encode when the recording is MP4. */
            skipWhenAlreadyMp4: true,
            onStatus: function (s) { onStatus(s.message || '正在转换…'); }
        });
        return mp4Blob;
    }

    if (options.backgroundMusic && options.backgroundMusic.originalBlob) {
        onStatus('正在混合背景音乐…');
        var muxer = await import('./BrowserVideoTranscoder.js');
        return muxer.addBackgroundMusicToWebM(webmBlob, options.backgroundMusic, {
            duration: recordedDuration / 1000,
            onStatus: function (s) { onStatus(s.message || '正在混合音乐…'); }
        });
    }

    /* Stream tracks and the recorder are already torn down in the finally
       block above; the export canvas is garbage-collected with this scope. */
    return webmBlob;
}
