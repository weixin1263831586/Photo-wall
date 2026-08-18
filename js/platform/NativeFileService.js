var tauriRuntime = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;
var PLAY_CACHE_PREFIX = 'play-';
var PLAY_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; /* 24 hours */

export function isNativeApp() {
    return tauriRuntime;
}

/**
 * Remove stale play-* cache files left by previous system-player opens.
 * Only deletes files older than 24h to avoid clobbering a player that
 * might still be reading a just-created file.
 */
export async function cleanupPlayCache() {
    if (!tauriRuntime) return;
    try {
        var filesystem = await import('@tauri-apps/plugin-fs');
        var pathAPI = await import('@tauri-apps/api/path');
        var cacheDir = await pathAPI.appCacheDir();
        var entries;
        try {
            entries = await filesystem.readDir(cacheDir);
        } catch (_) {
            return; /* directory doesn't exist yet — nothing to clean */
        }
        var now = Date.now();
        for (var i = 0; i < entries.length; i++) {
            var name = entries[i].name || entries[i];
            if (typeof name !== 'string' || !name.startsWith(PLAY_CACHE_PREFIX)) continue;
            /* Extract the timestamp from the filename: play-<timestamp36>-<file> */
            var parts = name.split('-');
            if (parts.length < 3) continue;
            var created = parseInt(parts[1], 36);
            if (Number.isFinite(created) && (now - created) > PLAY_CACHE_MAX_AGE_MS) {
                try {
                    var fullPath = await pathAPI.join(cacheDir, name);
                    await filesystem.remove(fullPath);
                } catch (_) { /* best-effort */ }
            }
        }
    } catch (_) { /* best-effort, never block the app */ }
}

function browserDownload(blob, fileName) {
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    return Promise.resolve({ saved: true, native: false });
}

function safeFileName(fileName) {
    return String(fileName || 'video.mp4').replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').replace(/[. ]+$/, '') || 'video.mp4';
}

/** Open a preserved original media file with the OS player when possible. */
export async function openBlobWithSystem(blob, fileName) {
    fileName = safeFileName(fileName);
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function' && typeof File !== 'undefined') {
        var sharedFile = new File([blob], fileName, { type: blob.type || 'video/mp4' });
        var shareData = { files: [sharedFile], title: fileName };
        if (typeof navigator.canShare !== 'function' || navigator.canShare(shareData)) {
            try {
                await navigator.share(shareData);
                return { opened: true, shared: true, native: tauriRuntime };
            } catch (error) {
                if (error && error.name === 'AbortError') return { opened: false, cancelled: true, native: tauriRuntime };
                console.warn('系统分享播放器不可用，继续尝试文件打开。', error);
            }
        }
    }
    if (!tauriRuntime) return browserDownload(blob, fileName);
    try {
        var filesystem = await import('@tauri-apps/plugin-fs');
        var pathAPI = await import('@tauri-apps/api/path');
        var coreAPI = await import('@tauri-apps/api/core');
        var cacheDirectory = await pathAPI.appCacheDir();
        var cacheName = 'play-' + Date.now().toString(36) + '-' + fileName;
        var cachePath = await pathAPI.join(cacheDirectory, cacheName);
        await filesystem.writeFile(cachePath, new Uint8Array(await blob.arrayBuffer()));
        /* Android 7+ StrictMode blocks ACTION_VIEW on plain file:// URIs, so
           the cached file is exposed through the app FileProvider instead.
           The opener plugin's file:// path silently fails on device. */
        if (/android/i.test(String(navigator.userAgent))) {
            await coreAPI.invoke('plugin:native-video|open_file', {
                payload: { path: cachePath, mimeType: blob.type || 'video/mp4' }
            });
        } else {
            var opener = await import('@tauri-apps/plugin-opener');
            await opener.openPath(cachePath);
        }
        /* Best-effort cleanup of stale play-* files from earlier sessions. */
        cleanupPlayCache();
        return { opened: true, native: true, path: cachePath };
    } catch (error) {
        console.warn('系统播放器打开失败，改为保存原视频。', error);
        return saveBlob(blob, {
            fileName: fileName,
            title: '保存原视频后使用系统播放器打开',
            filters: [{ name: '视频', extensions: [fileName.split('.').pop() || 'mp4'] }]
        });
    }
}

/** Save through the OS dialog in Tauri, with browser download as fallback. */
export async function saveBlob(blob, options) {
    options = options || {};
    var fileName = options.fileName || 'photo-wall.bin';
    if (!tauriRuntime) return browserDownload(blob, fileName);
    try {
        var dialog = await import('@tauri-apps/plugin-dialog');
        var filesystem = await import('@tauri-apps/plugin-fs');
        var path = await dialog.save({
            title: options.title || '保存文件',
            defaultPath: fileName,
            filters: options.filters || []
        });
        if (!path) return { saved: false, cancelled: true, native: true };
        await filesystem.writeFile(path, new Uint8Array(await blob.arrayBuffer()));
        return { saved: true, native: true, path: path };
    } catch (error) {
        console.warn('原生保存失败，已回退浏览器下载。', error);
        return browserDownload(blob, fileName);
    }
}
