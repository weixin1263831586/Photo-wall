function finiteNumber(value, fallback) {
    value = Number(value);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Derive conservative runtime limits from browser hints. All inputs are
 * injectable so the policy can be unit-tested without a DOM.
 */
export function createDeviceProfile(options) {
    options = options || {};
    var viewportWidth = finiteNumber(options.viewportWidth, 1280);
    var coarsePointer = options.coarsePointer === true;
    // A touchscreen Windows laptop may report a coarse primary pointer. Keep
    // full desktop limits on wide windows and treat only phone/tablet widths as
    // mobile-class devices.
    var mobile = options.mobile === true || viewportWidth <= 768 || (coarsePointer && viewportWidth <= 1024);
    var memoryGB = finiteNumber(options.deviceMemory, mobile ? 4 : 8);
    var cpuCount = Math.max(2, Math.floor(finiteNumber(options.hardwareConcurrency, 4)));
    var lowMemory = memoryGB <= 4;

    return {
        mobile: mobile,
        lowMemory: lowMemory,
        memoryGB: memoryGB,
        cpuCount: cpuCount,
        photoLoadConcurrency: mobile || lowMemory ? 2 : Math.min(6, Math.max(3, Math.floor(cpuCount / 2))),
        analysisWorkers: mobile || lowMemory ? 1 : Math.min(4, Math.max(2, Math.floor(cpuCount / 4))),
        maxEditorDpr: mobile && lowMemory ? 1.5 : 2,
        maxPhotoDimension: mobile ? (lowMemory ? 1200 : 1440) : 1600,
        historyLimit: mobile ? (lowMemory ? 12 : 20) : 30,
        maxExportPixels: mobile ? (lowMemory ? 12 : 20) * 1000000 : 40 * 1000000,
        recommendedPhotoCount: mobile ? (lowMemory ? 300 : 500) : 1000
    };
}

export function getImportDimension(profile, projectedCount) {
    profile = profile || createDeviceProfile();
    projectedCount = Math.max(0, Number(projectedCount) || 0);
    var dimension;
    if (projectedCount > 600) dimension = 480;
    else if (projectedCount > 300) dimension = 640;
    else if (projectedCount > 150) dimension = 800;
    else if (projectedCount > 60) dimension = 1200;
    else dimension = profile.maxPhotoDimension || 1600;

    if (profile.mobile) {
        if (projectedCount > 300) dimension = Math.min(dimension, 480);
        else if (projectedCount > 150) dimension = Math.min(dimension, 640);
        else if (projectedCount > 60) dimension = Math.min(dimension, 800);
        else dimension = Math.min(dimension, profile.maxPhotoDimension || 1200);
    }
    return Math.max(320, dimension);
}
