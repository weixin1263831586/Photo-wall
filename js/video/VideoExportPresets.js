export const VIDEO_EXPORT_PRESETS = Object.freeze({
    source: { id: 'source', label: '跟随当前画布', width: 0, height: 0, aspectRatio: 'auto', fps: 30 },
    portrait: { id: 'portrait', label: '竖屏 1080 × 1920', width: 1080, height: 1920, aspectRatio: '9:16', fps: 30 },
    landscape: { id: 'landscape', label: '横屏 1920 × 1080', width: 1920, height: 1080, aspectRatio: '16:9', fps: 30 },
    square: { id: 'square', label: '方形 1080 × 1080', width: 1080, height: 1080, aspectRatio: '1:1', fps: 30 }
});

export function getVideoExportPreset(id) {
    return VIDEO_EXPORT_PRESETS[id] || VIDEO_EXPORT_PRESETS.source;
}

export function resolveVideoExportDimensions(id, fallback) {
    var preset = getVideoExportPreset(id);
    if (preset.width && preset.height) return { width: preset.width, height: preset.height, aspectRatio: preset.aspectRatio, fps: preset.fps };
    fallback = fallback || {};
    return {
        width: Math.max(1, Math.round(Number(fallback.width) || 1080)),
        height: Math.max(1, Math.round(Number(fallback.height) || 1920)),
        aspectRatio: fallback.aspectRatio || 'auto',
        fps: preset.fps
    };
}
