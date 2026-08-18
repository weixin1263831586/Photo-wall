export function createPhotoAnalysisWorkerClient(options) {
    options = options || {};
    var workers = [];
    var nextWorker = 0;
    var sequence = 0;
    var pending = new Map();
    var timeoutMs = Math.max(1000, Number(options.timeout) || 15000);

    try {
        if (typeof Worker !== 'undefined') {
            var workerCount = Math.max(1, Math.min(4, Number(options.workers) || 1));
            function handleMessage(event) {
                var request = pending.get(event.data.id);
                if (!request) return;
                pending.delete(event.data.id);
                clearTimeout(request.timeout);
                if (event.data.error) request.reject(new Error(event.data.error));
                else request.resolve(event.data.analysis);
            }
            function handleError(event) {
                /* Only reject requests that belong to the failed worker, not all. */
                var failedWorker = event.target;
                var failedIndex = workers.indexOf(failedWorker);
                pending.forEach(function (request, id) {
                    if (request.workerIndex !== failedIndex) return;
                    clearTimeout(request.timeout);
                    request.reject(new Error(event.message || 'photo analysis worker failed'));
                    pending.delete(id);
                });
                /* Remove the failed worker so round-robin skips it. */
                if (failedIndex !== -1) {
                    workers.splice(failedIndex, 1);
                    try { failedWorker.terminate(); } catch (_) {}
                    /* Re-index remaining pending requests' workerIndex. */
                    pending.forEach(function (request) {
                        if (request.workerIndex > failedIndex) request.workerIndex--;
                    });
                }
            }
            for (var index = 0; index < workerCount; index++) {
                var worker = new Worker(new URL('../workers/photo-analysis.worker.js', import.meta.url), { type: 'module' });
                worker.addEventListener('message', handleMessage);
                worker.addEventListener('error', handleError);
                workers.push(worker);
            }
        }
    } catch (error) {
        workers.forEach(function (worker) { worker.terminate(); });
        workers = [];
    }

    function analyze(blob) {
        if (!workers.length || !(blob instanceof Blob)) return Promise.reject(new Error('photo analysis worker unavailable'));
        return new Promise(function (resolve, reject) {
            var id = ++sequence;
            var workerIndex = nextWorker++ % workers.length;
            var timeout = setTimeout(function () {
                pending.delete(id);
                reject(new Error('photo analysis worker timed out'));
            }, timeoutMs);
            pending.set(id, { resolve: resolve, reject: reject, timeout: timeout, workerIndex: workerIndex });
            workers[workerIndex].postMessage({ id: id, blob: blob });
        });
    }

    function terminate() {
        workers.forEach(function (worker) { worker.terminate(); });
        workers = [];
        pending.forEach(function (request) {
            clearTimeout(request.timeout);
            request.reject(new Error('photo analysis worker terminated'));
        });
        pending.clear();
    }

    return { analyze: analyze, terminate: terminate, available: function () { return workers.length > 0; } };
}
