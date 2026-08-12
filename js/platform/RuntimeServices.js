const CRASH_STORAGE_KEY = 'photo-wall-crash-reports-v1';
const MAX_CRASH_REPORTS = 10;

function nativeRuntime() {
    return typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);
}

function serializeReason(reason) {
    if (reason instanceof Error) return { message: reason.message, stack: reason.stack || '' };
    if (reason && typeof reason === 'object') {
        try { return { message: JSON.stringify(reason).slice(0, 3000), stack: '' }; } catch (ignore) {}
    }
    return { message: String(reason || 'Unknown error').slice(0, 3000), stack: '' };
}

export function createCrashReport(reason, context) {
    var error = serializeReason(reason);
    return {
        timestamp: new Date().toISOString(),
        message: error.message,
        stack: String(error.stack || '').slice(0, 12000),
        context: String(context || 'javascript').slice(0, 80),
        appVersion: '1.0.0',
        platform: typeof navigator !== 'undefined' ? navigator.platform : '',
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 500) : ''
    };
}

export function storeCrashReport(report, storage) {
    storage = storage === undefined ? globalThis.localStorage : storage;
    if (!storage) return;
    try {
        var reports = JSON.parse(storage.getItem(CRASH_STORAGE_KEY) || '[]');
        if (!Array.isArray(reports)) reports = [];
        reports.unshift(report);
        storage.setItem(CRASH_STORAGE_KEY, JSON.stringify(reports.slice(0, MAX_CRASH_REPORTS)));
    } catch (ignore) {}
}

async function writeNativeLog(level, message) {
    if (!nativeRuntime()) return;
    try {
        var logger = await import('@tauri-apps/plugin-log');
        await logger[level](message);
    } catch (ignore) {}
}

export function installCrashCapture() {
    if (typeof window === 'undefined') return function () {};
    function capture(reason, context) {
        var report = createCrashReport(reason, context);
        storeCrashReport(report);
        writeNativeLog('error', '[crash-report] ' + JSON.stringify(report));
    }
    function onError(event) { capture(event.error || event.message, 'window.error'); }
    function onRejection(event) { capture(event.reason, 'unhandledrejection'); }
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    writeNativeLog('info', '[runtime] application started');
    return function () {
        window.removeEventListener('error', onError);
        window.removeEventListener('unhandledrejection', onRejection);
    };
}

export async function checkAndInstallUpdate(options) {
    options = options || {};
    if (!nativeRuntime()) return { supported: false };
    try {
        var updater = await import('@tauri-apps/plugin-updater');
        var update = await updater.check();
        if (!update) return { supported: true, available: false };
        var accept = options.confirm ? options.confirm(update) : true;
        if (!accept) {
            await update.close();
            return { supported: true, available: true, installed: false };
        }
        var downloaded = 0;
        var total = 0;
        await update.downloadAndInstall(function (event) {
            if (event.event === 'Started') total = Number(event.data.contentLength) || 0;
            if (event.event === 'Progress') downloaded += Number(event.data.chunkLength) || 0;
            if (options.onProgress) options.onProgress({ downloaded: downloaded, total: total, event: event.event });
        });
        if (options.beforeRestart) await options.beforeRestart();
        var process = await import('@tauri-apps/plugin-process');
        await process.relaunch();
        return { supported: true, available: true, installed: true };
    } catch (error) {
        await writeNativeLog('error', '[updater] ' + serializeReason(error).message);
        if (options.onError) options.onError(error);
        return { supported: true, error: error };
    }
}

export { CRASH_STORAGE_KEY, MAX_CRASH_REPORTS };
