/**
 * VideoRecorder — drives a PlaybackTimeline and records the canvas to a
 * WebM video via MediaRecorder / canvas.captureStream.
 *
 * Android APKs bypass MediaRecorder entirely and use the native Media3 frame
 * exporter. MP4 output on other platforms can still be passed through the
 * existing native/browser transcoders.
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
    var signal = currentSignal(options);
    var completed = false;

    dispatchExportEvent('start', { format: format, android: isAndroidNativeApp() });
    throwIfAborted(signal);

    try {
        if (isAndroidNativeApp()) {
            var androidResult = await recordTimelineOnAndroid(wall, timeline, Object.assign({}, options, {
                format: 'mp4',
                fps: Math.min(15, fps),
                signal: signal
            }));
            completed = true;
            return androidResult;
        }

        if (typeof MediaRecorder === 'undefined') {
            throw new Error('当前浏览器不支持视频录制（MediaRecorder 不可用）');
        }

        var mimeType = pickVideoMimeType(format);
        if (!mimeType) throw new Error('当前浏览器不支持 WebM 视频录制');

        var exportCanvas = document.createElement('canvas');
        var exportCtx = exportCanvas.getContext('2d');
        if (!exportCtx) throw new Error('视频导出画布不可用');
        var pixelWidth = Math.round(cssWidth * scale);
        var pixelHeight = Math.round(cssHeight * scale);
        exportCanvas.width = pixelWidth;
        exportCanvas.height = pixelHeight;

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
        recorder.onerror = function (event) {
            recorderError = (event && event.error) || new Error('视频录制失败');
        };

        var frameDuration = 1000 / fps;
        var totalFrames = Math.ceil(timeline.duration / frameDuration) + 1;
        if (totalFrames < 1) totalFrames = 1;

        onStatus('正在渲染视频…');
        dispatchExportEvent('status', { stage: 'frames', message: '正在渲染视频…' });

        var now = typeof performance !== 'undefined' && performance.now ?
            function () { return performance.now(); } : function () { return Date.now(); };
        var startedAt = now();

        async function waitUntil(target) {
            throwIfAborted(signal);
            var remaining = target - now();
            if (remaining > 10) {
                await new Promise(function (resolve) { setTimeout(resolve, Math.max(0, remaining - 4)); });
            }
            while (now() < target) {
                throwIfAborted(signal);
                await new Promise(function (resolve) {
                    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(resolve);
                    else setTimeout(resolve, 1);
                });
            }
        }

        async function waitForCommit() {
            await new Promise(function (resolve) {
                if (typeof requestAnimationFrame === 'function') requestAnimationFrame(resolve);
                else setTimeout(resolve, 16);
            });
            throwIfAborted(signal);
            await new Promise(function (resolve) {
                if (typeof requestAnimationFrame === 'function') requestAnimationFrame(resolve);
                else setTimeout(resolve, 1);
            });
        }

        var sourceFrame = wall.getExportFrame(options.aspectRatio || 'auto');
        var background = options.background || 'transparent';
        var recordedDuration = timeline.duration;

        try {
            var recordingStartedAt = now();
            recorder.start();
            for (var frame = 0; frame < totalFrames; frame++) {
                throwIfAborted(signal);
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
                throwIfAborted(signal);
                if (canRequestFrame) {
                    videoTrack.requestFrame();
                    await waitForCommit();
                }

                onProgress(frame + 1, totalFrames);
                dispatchExportEvent('progress', {
                    stage: 'frames',
                    percent: Math.round((frame + 1) / totalFrames * 82),
                    current: frame + 1,
                    total: totalFrames
                });
                if (recorderError) throw recorderError;
            }

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
            throwIfAborted(signal);

            onStatus('正在保存视频…');
            dispatchExportEvent('progress', { stage: 'saving', percent: 86, indeterminate: true });
            if (recorderError) throw recorderError;
            var stopPromise = new Promise(function (resolve, reject) {
                recorder.onstop = resolve;
                recorder.onerror = function (event) { reject(event.error || new Error('视频录制失败')); };
            });
            recorder.stop();
            await stopPromise;
            recordedDuration = Math.max(timeline.duration, now() - recordingStartedAt);
        } finally {
            stream.getTracks().forEach(function (track) { track.stop(); });
            if (recorder.state === 'recording') {
                try { recorder.stop(); } catch (_) {}
            }
            exportCanvas.width = 1;
            exportCanvas.height = 1;
        }

        throwIfAborted(signal);
        var recordedType = String(recorder.mimeType || mimeType || 'video/webm').split(';')[0];
        var webmBlob = new Blob(chunks, { type: recordedType });
        if (webmBlob.size < 512) throw new Error('视频录制没有生成有效画面');

        if (format === 'mp4') {
            onStatus('正在转换为 MP4…');
            dispatchExportEvent('progress', { stage: 'encoding', percent: 90, indeterminate: true });
            var transcoder = await import('./NativeVideoTranscoder.js');
            var mp4Blob = await transcoder.transcodeVideoForPlatform(webmBlob, {
                backgroundMusic: options.backgroundMusic,
                duration: recordedDuration / 1000,
                skipWhenAlreadyMp4: true,
                onStatus: function (status) {
                    onStatus(status.message || '正在转换…');
                    dispatchExportEvent('status', { stage: 'encoding', message: status.message || '正在转换…' });
                }
            });
            throwIfAborted(signal);
            completed = true;
            dispatchExportEvent('progress', { stage: 'complete', percent: 100 });
            return mp4Blob;
        }

        if (options.backgroundMusic && options.backgroundMusic.originalBlob) {
            onStatus('正在混合背景音乐…');
            dispatchExportEvent('progress', { stage: 'audio', percent: 90, indeterminate: true });
            var muxer = await import('./BrowserVideoTranscoder.js');
            var mixedBlob = await muxer.addBackgroundMusicToWebM(webmBlob, options.backgroundMusic, {
                duration: recordedDuration / 1000,
                onStatus: function (status) { onStatus(status.message || '正在混合音乐…'); }
            });
            throwIfAborted(signal);
            completed = true;
            dispatchExportEvent('progress', { stage: 'complete', percent: 100 });
            return mixedBlob;
        }

        completed = true;
        dispatchExportEvent('progress', { stage: 'complete', percent: 100 });
        return webmBlob;
    } catch (error) {
        if (signal && signal.aborted) throw abortError();
        throw error;
    } finally {
        dispatchExportEvent('end', {
            completed: completed,
            cancelled: Boolean(signal && signal.aborted)
        });
        if (signal && signal === activeAbortSignal) activeAbortSignal = null;
        if (typeof window !== 'undefined' && signal && signal === window.__PHOTO_WALL_EXPORT_ABORT_SIGNAL__) {
            window.__PHOTO_WALL_EXPORT_ABORT_SIGNAL__ = null;
            window.__PHOTO_WALL_EXPORT_ABORT_CONTROLLER__ = null;
        }
    }
}
