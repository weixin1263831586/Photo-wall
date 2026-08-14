function clamp(value, min, max, fallback) {
    value = Number(value);
    return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

export function normalizeBackgroundMusic(music) {
    if (!music) return null;
    var duration = Math.max(0, Number(music.duration) || 0);
    var startTime = clamp(music.startTime, 0, Math.max(0, duration - 0.05), 0);
    var endTime = clamp(music.endTime, Math.min(duration, startTime + 0.05), duration, duration);
    return {
        name: String(music.name || '背景音乐').slice(0, 180),
        type: String(music.type || 'audio/mpeg').slice(0, 80),
        duration: duration,
        volume: clamp(music.volume, 0, 1, 0.7),
        startTime: startTime,
        endTime: endTime,
        loop: music.loop !== false,
        fadeIn: clamp(music.fadeIn, 0, 10, 1),
        fadeOut: clamp(music.fadeOut, 0, 10, 1),
        originalBlob: music.originalBlob instanceof Blob ? music.originalBlob : null
    };
}

export function musicSegmentDuration(music) {
    music = normalizeBackgroundMusic(music);
    return music ? Math.max(0, music.endTime - music.startTime) : 0;
}

export function musicVolumeAt(music, elapsedSeconds, totalSeconds) {
    music = normalizeBackgroundMusic(music);
    if (!music) return 0;
    var elapsed = Math.max(0, Number(elapsedSeconds) || 0);
    var total = Math.max(0, Number(totalSeconds) || 0);
    var fadeInGain = music.fadeIn > 0 ? Math.min(1, elapsed / music.fadeIn) : 1;
    var remaining = Math.max(0, total - elapsed);
    var fadeOutGain = total > 0 && music.fadeOut > 0 ? Math.min(1, remaining / music.fadeOut) : 1;
    return music.volume * Math.min(fadeInGain, fadeOutGain);
}
