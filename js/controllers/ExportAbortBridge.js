// Capture the export intent before app.js's bubble-phase handler starts the
// recorder. This guarantees VideoRecorder sees an AbortSignal from its first
// synchronous instruction instead of racing a dynamic import.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    document.addEventListener('click', function (event) {
        var target = event.target && event.target.closest ? event.target.closest('#export-confirm') : null;
        if (!target) return;
        var category = document.querySelector('input[name="export-category"]:checked');
        var format = document.querySelector('input[name="export-format"]:checked');
        var video = (category && category.value === 'video') ||
            (format && (format.value === 'mp4' || format.value === 'webm'));
        if (!video) return;
        var controller = new AbortController();
        window.__PHOTO_WALL_EXPORT_ABORT_CONTROLLER__ = controller;
        window.__PHOTO_WALL_EXPORT_ABORT_SIGNAL__ = controller.signal;
    }, true);

    document.addEventListener('click', function (event) {
        var cancel = event.target && event.target.closest ? event.target.closest('#video-export-cancel') : null;
        if (!cancel) return;
        var controller = window.__PHOTO_WALL_EXPORT_ABORT_CONTROLLER__;
        if (controller && !controller.signal.aborted) controller.abort();
    }, true);

    window.addEventListener('photowall:video-export-end', function () {
        window.__PHOTO_WALL_EXPORT_ABORT_CONTROLLER__ = null;
        window.__PHOTO_WALL_EXPORT_ABORT_SIGNAL__ = null;
    });
}
