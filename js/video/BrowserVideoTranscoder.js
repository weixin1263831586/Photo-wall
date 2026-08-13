const MAX_BROWSER_TRANSCODE_BYTES = 120 * 1024 * 1024;

var ffmpegPromise = null;
var transcodeQueue = Promise.resolve();
var resultCache = new WeakMap();
var progressListener = function () {};

function extensionFor(blob, name) {
    var match = String(name || '').toLowerCase().match(/\.([a-z0-9]{2,5})$/);
    if (match && /^(mp4|mov|m4v|webm)$/.test(match[1])) return match[1];
    if (blob.type === 'video/webm') return 'webm';
    if (blob.type === 'video/quicktime') return 'mov';
    return 'mp4';
}

async function loadFFmpeg(onStatus) {
    if (!ffmpegPromise) {
        ffmpegPromise = Promise.all([
            import('@ffmpeg/ffmpeg'),
            import('@ffmpeg/util'),
            import('@ffmpeg/core?url'),
            import('@ffmpeg/core/wasm?url'),
            import('@ffmpeg/ffmpeg/worker?url')
        ]).then(async function (modules) {
            var ffmpeg = new modules[0].FFmpeg();
            ffmpeg.on('progress', function (event) { progressListener(event); });
            if (onStatus) onStatus({ phase: 'loading', message: '首次加载本地视频引擎（约 31 MB）…' });
            var timeout;
            try {
                await Promise.race([
                    ffmpeg.load({
                        coreURL: modules[2].default,
                        wasmURL: modules[3].default,
                        classWorkerURL: modules[4].default
                    }),
                    new Promise(function (_, reject) {
                        timeout = setTimeout(function () { reject(new Error('本地视频引擎加载超时')); }, 60000);
                    })
                ]);
            } catch (error) {
                ffmpeg.terminate();
                throw error;
            } finally {
                clearTimeout(timeout);
            }
            return { ffmpeg: ffmpeg, fetchFile: modules[1].fetchFile };
        }).catch(function (error) {
            ffmpegPromise = null;
            throw error;
        });
    }
    var engine = await ffmpegPromise;
    if (onStatus) onStatus({ phase: 'ready', message: '正在准备视频…' });
    return engine;
}

async function runTranscode(blob, options) {
    options = options || {};
    if (!(blob instanceof Blob) || !blob.size) throw new Error('没有可转码的视频数据');
    if (blob.size > MAX_BROWSER_TRANSCODE_BYTES) throw new Error('视频超过 120 MB，请使用系统播放器打开原文件');
    var cached = resultCache.get(blob);
    if (cached) return cached;

    var engine = await loadFFmpeg(options.onStatus);
    var ffmpeg = engine.ffmpeg;
    var id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    var inputName = 'input-' + id + '.' + extensionFor(blob, options.name);
    var outputName = 'output-' + id + '.mp4';
    progressListener = function (event) {
        if (!options.onStatus || !Number.isFinite(event.progress)) return;
        var progress = Math.max(0, Math.min(1, event.progress));
        options.onStatus({ phase: 'transcoding', progress: progress, message: '正在本地转码 ' + Math.round(progress * 100) + '%…' });
    };
    try {
        await ffmpeg.writeFile(inputName, await engine.fetchFile(blob));
        var exitCode = await ffmpeg.exec([
            '-i', inputName,
            '-map', '0:v:0', '-map', '0:a?',
            '-vf', 'scale=1280:1280:force_original_aspect_ratio=decrease',
            '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '27',
            '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-b:a', '128k',
            '-movflags', '+faststart',
            outputName
        ], 180000);
        if (exitCode !== 0) throw new Error('视频转码失败（代码 ' + exitCode + '）');
        var output = await ffmpeg.readFile(outputName);
        if (!(output instanceof Uint8Array) || !output.byteLength) throw new Error('视频转码没有生成有效文件');
        var result = new Blob([output], { type: 'video/mp4' });
        resultCache.set(blob, result);
        if (options.onStatus) options.onStatus({ phase: 'complete', progress: 1, message: '转码完成，正在播放…' });
        return result;
    } finally {
        progressListener = function () {};
        try { await ffmpeg.deleteFile(inputName); } catch (ignore) {}
        try { await ffmpeg.deleteFile(outputName); } catch (ignore) {}
    }
}

export function transcodeVideoForBrowser(blob, options) {
    var job = transcodeQueue.then(function () { return runTranscode(blob, options); });
    transcodeQueue = job.catch(function () {});
    return job;
}

export { MAX_BROWSER_TRANSCODE_BYTES };
