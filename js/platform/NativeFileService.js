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
