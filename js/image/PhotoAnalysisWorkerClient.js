export function createPhotoAnalysisWorkerClient(options) {
    options = options || {};
    var worker = null;
    var sequence = 0;
    var pending = new Map();
    var timeoutMs = Math.max(1000, Number(options.timeout) || 15000);

    try {
        if (typeof Worker !== 'undefined') {
            worker = new Worker(new URL('../workers/photo-analysis.worker.js', import.meta.url), { type: 'module' });
            worker.addEventListener('message', function (event) {
                var request = pending.get(event.data.id);
                if (!request) return;
                pending.delete(event.data.id);
                clearTimeout(request.timeout);
                if (event.data.error) request.reject(new Error(event.data.error));
                else request.resolve(event.data.analysis);
            });
            worker.addEventListener('error', function (event) {
                pending.forEach(function (request) {
                    clearTimeout(request.timeout);
                    request.reject(new Error(event.message || 'photo analysis worker failed'));
                });
                pending.clear();
            });
        }
    } catch (error) {
        worker = null;
    }

    function analyze(blob) {
        if (!worker || !(blob instanceof Blob)) return Promise.reject(new Error('photo analysis worker unavailable'));
        return new Promise(function (resolve, reject) {
            var id = ++sequence;
            var timeout = setTimeout(function () {
                pending.delete(id);
                reject(new Error('photo analysis worker timed out'));
            }, timeoutMs);
            pending.set(id, { resolve: resolve, reject: reject, timeout: timeout });
            worker.postMessage({ id: id, blob: blob });
        });
    }

    function terminate() {
        if (worker) worker.terminate();
        worker = null;
        pending.forEach(function (request) {
            clearTimeout(request.timeout);
            request.reject(new Error('photo analysis worker terminated'));
        });
        pending.clear();
    }

    return { analyze: analyze, terminate: terminate, available: function () { return !!worker; } };
}
