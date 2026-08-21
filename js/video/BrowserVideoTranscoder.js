const MAX_BROWSER_TRANSCODE_BYTES = 120 * 1024 * 1024;
/* ffmpeg.wasm 0.12.x has no worker.onerror hook: when the wasm engine dies
   (OOM crash) or stalls in a phase without progress callbacks, exec() never
   settles and the transcode queue blocks forever. This watchdog converts the
   silent hang into a normal error so the engine resets and the UI recovers. */
const STALL_TIMEOUT_MS = 90000;

var ffmpegPromise = null;
var transcodeQueue = Promise.resolve();
var resultCache = new WeakMap();
var progressListener = function () {};
var lastEngineActivityAt = 0;

function execWithStallWatchdog(ffmpeg, args, timeout, label) {
    lastEngineActivityAt = Date.now();
    var pending = ffmpeg.exec(args, timeout);
    /* If the watchdog fires first, terminate() later force-rejects the still
       pending exec; mark it handled so it never surfaces as an
       unhandledrejection crash report. */
    pending.catch(function () {});
    var timer;
    var guard = new Promise(function (_, reject) {
        timer = setInterval(function () {
            if (Date.now() - lastEngineActivityAt >= STALL_TIMEOUT_MS) {
                reject(new Error(label + '：本地转码引擎已停止响应，已自动重置。请重试，或改用 WebM 格式 / 降低视频尺寸与时长'));
            }
        }, 5000);
    });
    return Promise.race([pending, guard]).finally(function () { clearInterval(timer); });
}

function extensionFor(blob, name) {
    var match = String(name || '').toLowerCase().match(/\.([a-z0-9]{2,5})$/);
    if (match && /^(mp4|mov|m4v|webm|mkv|avi|3gp|mpeg|mpg)$/.test(match[1])) return match[1];
    if (blob.type === 'video/webm') return 'webm';
    if (blob.type === 'video/quicktime') return 'mov';
    if (blob.type === 'video/x-matroska') return 'mkv';
    if (blob.type === 'video/x-msvideo') return 'avi';
    if (blob.type === 'video/3gpp') return '3gp';
    if (blob.type === 'video/mpeg') return 'mpeg';
    return 'mp4';
}

function audioExtension(blob, name) {
    var match = String(name || '').toLowerCase().match(/\.([a-z0-9]{2,5})$/);
    if (match && /^(mp3|wav|m4a|aac|ogg)$/.test(match[1])) return match[1];
    return {
        'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mp4': 'm4a',
        'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3'
    }[blob && blob.type] || 'mp3';
}

function clamp(value, min, max, fallback) {
    value = Number(value);
    return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function audioFilter(music, duration) {
    var volume = clamp(music.volume, 0, 1, 0.7);
    var fadeIn = Math.min(clamp(music.fadeIn, 0, 10, 1), duration / 2);
    var fadeOut = Math.min(clamp(music.fadeOut, 0, 10, 1), duration / 2);
    var filters = ['volume=' + volume.toFixed(3)];
    if (fadeIn > 0) filters.push('afade=t=in:st=0:d=' + fadeIn.toFixed(3));
    if (fadeOut > 0) filters.push('afade=t=out:st=' + Math.max(0, duration - fadeOut).toFixed(3) + ':d=' + fadeOut.toFixed(3));
    return filters.join(',');
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
            ffmpeg.on('progress', function (event) { lastEngineActivityAt = Date.now(); progressListener(event); });
            ffmpeg.on('log', function () { lastEngineActivityAt = Date.now(); });
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
    /* Argument problems are not engine failures — validate before loading
       ffmpeg so a bad request doesn't terminate the ~31 MB engine. */
    if (!(blob instanceof Blob) || !blob.size) throw new Error('没有可转码的视频数据');
    if (blob.size > MAX_BROWSER_TRANSCODE_BYTES) throw new Error('视频超过 120 MB，请使用系统播放器打开原文件');
    var music = options.backgroundMusic;
    var musicBlob = music && (music.originalBlob || music.blob);
    var outputFormat = options.outputFormat === 'webm' ? 'webm' : 'mp4';
    var cached = !musicBlob && outputFormat === 'mp4' ? resultCache.get(blob) : null;
    if (cached) return cached;

    var engine = await loadFFmpeg(options.onStatus);
    var ffmpeg = engine.ffmpeg;
    var id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    var inputName = 'input-' + id + '.' + extensionFor(blob, options.name);
    var outputName = 'output-' + id + '.' + outputFormat;
    var audioName = musicBlob instanceof Blob ? 'audio-' + id + '.' + audioExtension(musicBlob, music.name) : '';
    var segmentName = musicBlob instanceof Blob ? 'audio-segment-' + id + '.wav' : '';
    progressListener = function (event) {
        if (!options.onStatus || !Number.isFinite(event.progress)) return;
        var progress = Math.max(0, Math.min(1, event.progress));
        options.onStatus({ phase: 'transcoding', progress: progress, message: '正在本地转码 ' + Math.round(progress * 100) + '%…' });
    };
    try {
        await ffmpeg.writeFile(inputName, await engine.fetchFile(blob));
        var duration = Math.max(0.05, Number(options.duration) || 3600);
        var args = ['-i', inputName];
        if (audioName) {
            await ffmpeg.writeFile(audioName, await engine.fetchFile(musicBlob));
            var musicDuration = Math.max(0, Number(music.duration) || 0);
            var musicStart = clamp(music.startTime, 0, musicDuration, 0);
            var musicEnd = clamp(music.endTime, Math.min(musicDuration, musicStart + 0.05), musicDuration, musicDuration);
            var trimCode = await execWithStallWatchdog(ffmpeg, [
                '-ss', musicStart.toFixed(3), '-to', musicEnd.toFixed(3), '-i', audioName,
                '-vn', '-c:a', 'pcm_s16le', segmentName
            ], 60000, '背景音乐选段');
            if (trimCode !== 0) throw new Error('背景音乐选段失败（代码 ' + trimCode + '）');
            if (music.loop !== false) args.push('-stream_loop', '-1');
            args.push('-i', segmentName);
            args.push('-map', '0:v:0', '-map', '1:a:0', '-af', audioFilter(music, duration), '-t', duration.toFixed(3));
        } else {
            args.push('-map', '0:v:0', '-map', '0:a?');
        }
        if (outputFormat === 'webm') {
            /* MediaRecorder WebM already carries VP8/VP9, so the video stream
               can be copied straight into the output container. Re-encoding
               through libvpx-vp9 reliably OOM-crashes the single-threaded wasm
               core at encode flush, so it is reserved for inputs whose codec
               cannot live in WebM (e.g. an H.264 MP4 recording). */
            var isWebmSource = String(blob.type).indexOf('webm') >= 0 ||
                extensionFor(blob, options.name) === 'webm';
            if (isWebmSource) {
                args.push('-c:v', 'copy', '-c:a', 'libopus', '-b:a', '160k', outputName);
            } else {
                args.push('-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8',
                    '-b:v', '1M', '-c:a', 'libopus', '-b:a', '160k', outputName);
            }
        } else {
            args.push(
                '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
                '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '27',
                '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k',
                '-movflags', '+faststart', outputName
            );
        }
        var exitCode = await execWithStallWatchdog(ffmpeg, args, 180000, '视频转码');
        if (exitCode !== 0) throw new Error('视频转码失败（代码 ' + exitCode + '）');
        var output = await ffmpeg.readFile(outputName);
        if (!(output instanceof Uint8Array) || !output.byteLength) throw new Error('视频转码没有生成有效文件');
        var result = new Blob([output], { type: outputFormat === 'webm' ? 'video/webm' : 'video/mp4' });
        if (!musicBlob && outputFormat === 'mp4') resultCache.set(blob, result);
        if (options.onStatus) options.onStatus({ phase: 'complete', progress: 1, message: '转码完成，正在播放…' });
        return result;
    } catch (err) {
        /* Reset the engine so the next call re-loads a fresh worker. */
        try {
            var engine = await ffmpegPromise;
            if (engine && engine.ffmpeg) engine.ffmpeg.terminate();
        } catch (_) {}
        ffmpegPromise = null;
        throw err;
    } finally {
        progressListener = function () {};
        try { await ffmpeg.deleteFile(inputName); } catch (ignore) {}
        if (audioName) try { await ffmpeg.deleteFile(audioName); } catch (ignore) {}
        if (segmentName) try { await ffmpeg.deleteFile(segmentName); } catch (ignore) {}
        try { await ffmpeg.deleteFile(outputName); } catch (ignore) {}
    }
}

export function transcodeVideoForBrowser(blob, options) {
    var job = transcodeQueue.then(function () { return runTranscode(blob, options); });
    transcodeQueue = job.catch(function () {});
    return job;
}

export function addBackgroundMusicToWebM(blob, backgroundMusic, options) {
    return transcodeVideoForBrowser(blob, Object.assign({}, options || {}, {
        outputFormat: 'webm',
        backgroundMusic: backgroundMusic
    }));
}

export { MAX_BROWSER_TRANSCODE_BYTES };
