import { isNativeApp } from '../platform/NativeFileService.js';
import { writeBlobToFile, readFileAsBlob } from '../platform/BlobFileWriter.js';

function extensionFor(blob, fallback) {
    var type = String(blob && blob.type || '').toLowerCase();
    if (type.indexOf('webm') >= 0) return 'webm';
    if (type.indexOf('quicktime') >= 0) return 'mov';
    if (type.indexOf('matroska') >= 0) return 'mkv';
    if (type.indexOf('msvideo') >= 0) return 'avi';
    if (type.indexOf('3gpp') >= 0) return '3gp';
    if (type.indexOf('wav') >= 0) return 'wav';
    if (type.indexOf('mpeg') >= 0) return 'mp3';
    if (type.indexOf('ogg') >= 0) return 'ogg';
    if (type.indexOf('aac') >= 0) return 'aac';
    if (type.indexOf('audio/mp4') >= 0) return 'm4a';
    return fallback || 'mp4';
}

function nativeRuntimeAvailable() {
    return isNativeApp();
}

async function removeQuietly(filesystem, path) {
    if (!path) return;
    try { await filesystem.remove(path); } catch (ignore) {}
}

/**
 * Uses the Tauri native-video plugin when available. The recorded browser
 * stream is staged in the app cache, transcoded by the platform media stack,
 * read back once, and then removed. Any unsupported codec/device falls back
 * to the existing ffmpeg.wasm path.
 */
export async function transcodeVideoForPlatform(blob, options) {
    options = options || {};
    if (!nativeRuntimeAvailable()) {
        var browser = await import('./BrowserVideoTranscoder.js');
        return browser.transcodeVideoForBrowser(blob, options);
    }

    /* On native platforms MediaRecorder can already emit an H.264 MP4
       (pickVideoMimeType prefers mp4 mime candidates). Re-encoding it through
       the platform encoder would double the work for no gain, so only
       transcode when the recorded stream is not MP4 or audio must be mixed. */
    var hasMusic = Boolean(options.backgroundMusic &&
        (options.backgroundMusic.originalBlob || options.backgroundMusic.blob) instanceof Blob);
    if (options.skipWhenAlreadyMp4 === true && !hasMusic && /^video\/mp4/.test(String(blob.type))) {
        return blob;
    }

    var filesystem;
    var inputPath = '';
    var outputPath = '';
    var audioPath = '';
    try {
        var modules = await Promise.all([
            import('@tauri-apps/api/core'),
            import('@tauri-apps/api/path'),
            import('@tauri-apps/plugin-fs')
        ]);
        var invoke = modules[0].invoke;
        var pathAPI = modules[1];
        filesystem = modules[2];
        var capabilities = await invoke('plugin:native-video|capabilities');
        if (!capabilities || !capabilities.available) throw new Error('当前系统没有可用的原生编码器');

        var cacheDirectory = await pathAPI.appCacheDir();
        var jobId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
        inputPath = await pathAPI.join(cacheDirectory, 'native-video-' + jobId + '.' + extensionFor(blob, 'webm'));
        outputPath = await pathAPI.join(cacheDirectory, 'native-video-' + jobId + '.mp4');
        await writeBlobToFile(blob, filesystem, inputPath);

        var music = options.backgroundMusic;
        var musicBlob = music && (music.originalBlob || music.blob);
        if (musicBlob instanceof Blob) {
            audioPath = await pathAPI.join(cacheDirectory, 'native-audio-' + jobId + '.' + extensionFor(musicBlob, 'wav'));
            await writeBlobToFile(musicBlob, filesystem, audioPath);
        }
        if (options.onStatus) {
            options.onStatus({ phase: 'native', message: '正在使用' + capabilities.encoder + '编码…' });
        }
        var invokePromise = invoke('plugin:native-video|transcode', {
            payload: {
                inputPath: inputPath,
                outputPath: outputPath,
                audioPath: audioPath || null,
                duration: Math.max(0, Number(options.duration) || 0),
                volume: music ? music.volume : 0.7,
                startTime: music ? music.startTime : 0,
                endTime: music ? music.endTime : 0,
                loopAudio: music ? music.loop !== false : false,
                fadeIn: music ? music.fadeIn : 0,
                fadeOut: music ? music.fadeOut : 0
            }
        });
        /* If the race times out and we fall back, the native job keeps
           running; swallow its eventual rejection so it is not captured as
           an unhandledrejection crash report. */
        invokePromise.catch(function () {});
        var timeoutId;
        try {
            var result = await Promise.race([
                invokePromise,
                new Promise(function (_, reject) {
                    timeoutId = setTimeout(function () { reject(new Error('原生视频编码超时')); }, 300000);
                })
            ]);
            var exportBlob = await readFileAsBlob(filesystem, result.outputPath || outputPath, 'video/mp4');
            if (!exportBlob || exportBlob.size < 512) throw new Error('原生编码器未生成有效视频');
            return exportBlob;
        } finally {
            clearTimeout(timeoutId);
        }
    } catch (error) {
        console.warn('原生视频编码失败，回退到浏览器编码。', error);
        if (options.onStatus) options.onStatus({ phase: 'fallback', message: '原生编码不可用，正在使用本地兼容引擎…' });
        var fallback = await import('./BrowserVideoTranscoder.js');
        return fallback.transcodeVideoForBrowser(blob, options);
    } finally {
        if (filesystem) {
            await removeQuietly(filesystem, inputPath);
            await removeQuietly(filesystem, outputPath);
            await removeQuietly(filesystem, audioPath);
        }
    }
}
