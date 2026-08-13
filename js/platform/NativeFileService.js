var tauriRuntime = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

export function isNativeApp() {
    return tauriRuntime;
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
        var opener = await import('@tauri-apps/plugin-opener');
        var cacheDirectory = await pathAPI.appCacheDir();
        var cacheName = 'play-' + Date.now().toString(36) + '-' + fileName;
        var cachePath = await pathAPI.join(cacheDirectory, cacheName);
        await filesystem.writeFile(cachePath, new Uint8Array(await blob.arrayBuffer()));
        await opener.openPath(cachePath);
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
