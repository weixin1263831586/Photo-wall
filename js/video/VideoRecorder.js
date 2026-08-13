/**
 * VideoRecorder — drives a PlaybackTimeline and records the canvas to a
 * WebM video via MediaRecorder / canvas.captureStream.
 *
 * For MP4 output, the resulting WebM can be piped through the existing
 * BrowserVideoTranscoder (ffmpeg.wasm).
 */

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

/**
 * Pick the best supported WebM mimeType.
 */
export function pickVideoMimeType() {
    if (typeof MediaRecorder === 'undefined') return '';
    var nativeApp = typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);
    var candidates = nativeApp ? NATIVE_MP4_MIME_CANDIDATES.concat(WEBM_MIME_CANDIDATES) : WEBM_MIME_CANDIDATES;
    return candidates.find(function (c) {
        try { return MediaRecorder.isTypeSupported(c); } catch (_) { return false; }
    }) || '';
}

/**
 * Record a timeline-driven animation from a PhotoWall instance.
 *
 * @param {object} wall        PhotoWall instance (must have renderPlaybackFrame).
 * @param {object} timeline    PlaybackTimeline from createTimeline().
 * @param {object} options     {
 *   width, height,            — target canvas dimensions (CSS px)
 *   fps      default 30,
 *   format   'webm' | 'mp4',
 *   scale    export scale multiplier (default 1),
 *   onProgress(frame, total),
 *   onStatus(message)
 * }
 * @returns {Promise<Blob>}    Video blob.
 */
export async function recordTimelineCanvas(wall, timeline, options) {
    options = options || {};
    var cssWidth = Math.round(options.width || wall.cssWidth || 1080);
    var cssHeight = Math.round(options.height || wall.cssHeight || 1920);
    var fps = Math.max(10, Math.min(60, Number(options.fps) || 30));
    var format = options.format === 'mp4' ? 'mp4' : 'webm';
    var scale = Math.max(0.5, Number(options.scale) || 1);
    var onProgress = options.onProgress || function () {};
    var onStatus = options.onStatus || function () {};

    if (typeof MediaRecorder === 'undefined') {
        throw new Error('当前浏览器不支持视频录制（MediaRecorder 不可用）');
    }

    var mimeType = pickVideoMimeType();
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
    recorder.ondataavailable = function (event) {
        if (event.data && event.data.size > 0) chunks.push(event.data);
    };

    var frameDuration = 1000 / fps;
    var totalFrames = Math.ceil(timeline.duration / frameDuration) + 1;
    if (totalFrames < 1) totalFrames = 1;

    onStatus('正在渲染视频…');
    recorder.start();

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

    /* MediaRecorder timestamps frames in wall-clock time, so rendering is
       paced to the selected FPS instead of running one frame per display RAF. */
    for (var frame = 0; frame < totalFrames; frame++) {
        await waitUntil(startedAt + frame * frameDuration);
        var time = Math.min(timeline.duration, frame * frameDuration);
        var playbackFrame = timeline.getFrame(time);

        exportCtx.clearRect(0, 0, pixelWidth, pixelHeight);
        wall.renderPlaybackFrame(exportCtx, playbackFrame, {
            sourceFrame: wall.getExportFrame(options.aspectRatio || 'auto'),
            background: options.background || 'transparent'
        });
        if (canRequestFrame) videoTrack.requestFrame();

        onProgress(frame + 1, totalFrames);
    }

    /* Render one final frame to ensure the last state is captured. */
    wall.renderPlaybackFrame(exportCtx, timeline.getFrame(timeline.duration), {
        sourceFrame: wall.getExportFrame(options.aspectRatio || 'auto'),
        background: options.background || 'transparent'
    });
    if (canRequestFrame) videoTrack.requestFrame();

    await new Promise(function (resolve) { setTimeout(resolve, frameDuration); });

    onStatus('正在保存视频…');
    var stopPromise = new Promise(function (resolve) { recorder.onstop = resolve; });
    recorder.stop();
    await stopPromise;
    stream.getTracks().forEach(function (track) { track.stop(); });

    var recordedType = String(recorder.mimeType || mimeType || 'video/webm').split(';')[0];
    var webmBlob = new Blob(chunks, { type: recordedType });
    if (webmBlob.size < 512) throw new Error('视频录制没有生成有效画面');

    if (format === 'mp4') {
        onStatus('正在转换为 MP4…');
        var transcoder = await import('./NativeVideoTranscoder.js');
        var mp4Blob = await transcoder.transcodeVideoForPlatform(webmBlob, {
            backgroundMusic: options.backgroundMusic,
            duration: timeline.duration / 1000,
            onStatus: function (s) { onStatus(s.message || '正在转换…'); }
        });
        return mp4Blob;
    }

    if (options.backgroundMusic && options.backgroundMusic.originalBlob) {
        onStatus('正在混合背景音乐…');
        var muxer = await import('./BrowserVideoTranscoder.js');
        return muxer.addBackgroundMusicToWebM(webmBlob, options.backgroundMusic, {
            duration: timeline.duration / 1000,
            onStatus: function (s) { onStatus(s.message || '正在混合音乐…'); }
        });
    }

    return webmBlob;
}
