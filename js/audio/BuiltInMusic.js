/**
 * Small, original procedural music library.
 *
 * Tracks are synthesized on demand instead of shipping third-party recordings.
 * This keeps the installer small and makes every bundled track safe to reuse.
 */

const TRACKS = [
    { id: 'warm-memory', name: '温暖回忆', mood: '家庭·成长', bpm: 82, root: 60, progression: [0, 5, 3, 4], melody: [0, 2, 4, 7, 4, 2, 0, -3], color: '#f2aa6b' },
    { id: 'romantic-light', name: '浪漫微光', mood: '婚礼·约会', bpm: 72, root: 57, progression: [0, 3, 5, 4], melody: [4, 7, 9, 7, 4, 2, 0, 2], color: '#ef8fb8' },
    { id: 'travel-sun', name: '旅途晴空', mood: '旅行·风景', bpm: 112, root: 62, progression: [0, 4, 5, 3], melody: [0, 4, 7, 9, 7, 4, 2, 4], color: '#5dc9c2' },
    { id: 'birthday-pop', name: '甜蜜派对', mood: '生日·庆祝', bpm: 124, root: 60, progression: [0, 5, 4, 3], melody: [0, 4, 7, 12, 9, 7, 4, 2], color: '#ffc85f' },
    { id: 'graduation-road', name: '奔赴山海', mood: '毕业·青春', bpm: 98, root: 59, progression: [0, 3, 5, 4], melody: [0, 2, 3, 7, 5, 3, 2, -2], color: '#789cff' },
    { id: 'quiet-stars', name: '星空缓行', mood: '安静·纪念', bpm: 64, root: 55, progression: [0, 5, 2, 3], melody: [7, 4, 2, 0, -3, 0, 2, 4], color: '#9b91e8' },
    { id: 'ocean-breeze', name: '海风来信', mood: '海边·旅行', bpm: 88, root: 62, progression: [0, 5, 4, 3], melody: [0, 2, 7, 9, 7, 4, 2, -1], wave: 'sine', melodyGain: 0.19, kickGain: 0.09, color: '#50b8c6' },
    { id: 'playful-steps', name: '快乐脚步', mood: '亲子·萌宠', bpm: 132, root: 65, progression: [0, 4, 5, 4], melody: [0, 4, 7, 11, 7, 12, 9, 4], wave: 'soft-square', melodyGain: 0.14, kickGain: 0.22, color: '#f19f6b' },
    { id: 'victory-day', name: '高光时刻', mood: '毕业·荣誉', bpm: 118, root: 59, progression: [0, 5, 3, 4], melody: [0, 7, 9, 12, 9, 7, 4, 7], wave: 'triangle', melodyGain: 0.18, kickGain: 0.18, color: '#e4b84c' },
    { id: 'winter-wishes', name: '冬日祝愿', mood: '节日·团聚', bpm: 76, root: 60, progression: [0, 4, 5, 3], melody: [7, 9, 12, 9, 7, 4, 2, 4], wave: 'sine', melodyGain: 0.2, kickGain: 0.08, color: '#8cb9df' },
    { id: 'gentle-pages', name: '书页微光', mood: '阅读·安静', bpm: 68, root: 57, progression: [0, 3, 4, 5], melody: [0, 2, 4, 2, 7, 4, 2, -3], wave: 'triangle', melodyGain: 0.13, kickGain: 0.06, color: '#c3a6d8' },
    { id: 'city-night', name: '城市夜行', mood: '社交·夜景', bpm: 106, root: 54, progression: [0, 3, 5, 2], melody: [0, 3, 7, 10, 7, 5, 3, -2], wave: 'soft-square', melodyGain: 0.15, kickGain: 0.2, color: '#657bd8' },
    { id: 'spring-bloom', name: '春日花开', mood: '婚礼·自然', bpm: 92, root: 61, progression: [0, 5, 3, 4], melody: [0, 4, 7, 9, 11, 9, 7, 4], wave: 'sine', melodyGain: 0.2, kickGain: 0.1, color: '#eaa1b8' },
    { id: 'open-road', name: '旷野公路', mood: '户外·远行', bpm: 108, root: 57, progression: [0, 4, 3, 5], melody: [0, 2, 5, 7, 9, 7, 5, 2], wave: 'triangle', melodyGain: 0.17, kickGain: 0.17, color: '#86a66a' }
];

export const BUILT_IN_MUSIC = Object.freeze(TRACKS.map(function (track) {
    return Object.freeze(Object.assign({}, track));
}));

export function getBuiltInMusic(id) {
    return BUILT_IN_MUSIC.find(function (track) { return track.id === id; }) || null;
}

function midiFrequency(note) {
    return 440 * Math.pow(2, (note - 69) / 12);
}

function oscillator(phase, kind) {
    if (kind === 'triangle') return 2 / Math.PI * Math.asin(Math.sin(phase));
    if (kind === 'soft-square') return Math.tanh(Math.sin(phase) * 2.2) * 0.72;
    return Math.sin(phase);
}

function writeAscii(view, offset, value) {
    for (var i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
}

function createWaveBlob(track, options) {
    options = options || {};
    var sampleRate = Math.max(8000, Math.min(44100, Number(options.sampleRate) || 22050));
    var duration = Math.max(4, Math.min(30, Number(options.duration) || 16));
    var sampleCount = Math.floor(sampleRate * duration);
    var buffer = new ArrayBuffer(44 + sampleCount * 2);
    var view = new DataView(buffer);
    writeAscii(view, 0, 'RIFF');
    view.setUint32(4, 36 + sampleCount * 2, true);
    writeAscii(view, 8, 'WAVE');
    writeAscii(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeAscii(view, 36, 'data');
    view.setUint32(40, sampleCount * 2, true);

    var beatDuration = 60 / track.bpm;
    var chordIntervals = [0, 4, 7];
    var melodyKind = track.wave || (track.bpm > 110 ? 'soft-square' : 'triangle');
    var melodyGain = Math.max(0.08, Math.min(0.24, Number(track.melodyGain) || 0.17));
    var kickGain = Math.max(0.03, Math.min(0.24, Number(track.kickGain) || (track.bpm > 90 ? 0.20 : 0.12)));
    var seed = track.id.split('').reduce(function (sum, char) { return (sum * 33 + char.charCodeAt(0)) >>> 0; }, 2166136261);

    for (var sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
        var time = sampleIndex / sampleRate;
        var beat = time / beatDuration;
        var bar = Math.floor(beat / 4);
        var chordRoot = track.root + track.progression[bar % track.progression.length];
        var value = 0;

        for (var chordIndex = 0; chordIndex < chordIntervals.length; chordIndex++) {
            var chordFrequency = midiFrequency(chordRoot + chordIntervals[chordIndex] - 12);
            value += Math.sin(2 * Math.PI * chordFrequency * time + chordIndex * 0.6) * 0.105;
        }

        var melodyStep = Math.floor(beat * 2);
        var melodyNote = track.root + track.melody[melodyStep % track.melody.length] + 12;
        var noteTime = (beat * 2) % 1;
        var noteEnvelope = Math.min(1, noteTime * 14) * Math.exp(-noteTime * 2.7);
        value += oscillator(2 * Math.PI * midiFrequency(melodyNote) * time, melodyKind) * melodyGain * noteEnvelope;

        var beatPhase = beat % 1;
        value += Math.sin(2 * Math.PI * (72 - beatPhase * 34) * time) * Math.exp(-beatPhase * 11) * kickGain;
        if (track.bpm > 90 && (Math.floor(beat * 2) % 2 === 1)) {
            seed = (seed * 1664525 + 1013904223) >>> 0;
            var noise = seed / 4294967295 * 2 - 1;
            value += noise * Math.exp(-noteTime * 24) * 0.045;
        }

        var masterFade = Math.min(1, time / 0.7, (duration - time) / 0.9);
        var pcm = Math.max(-1, Math.min(1, value * Math.max(0, masterFade)));
        view.setInt16(44 + sampleIndex * 2, Math.round(pcm * 32767), true);
    }
    return new Blob([buffer], { type: 'audio/wav' });
}

export function createBuiltInMusicFile(id, options) {
    var track = getBuiltInMusic(id);
    if (!track) return Promise.reject(new Error('未知的内置音乐'));
    return Promise.resolve().then(function () {
        var blob = createWaveBlob(track, options);
        var fileName = track.id + '.wav';
        if (typeof File === 'function') return new File([blob], fileName, { type: blob.type });
        Object.defineProperty(blob, 'name', { configurable: true, value: fileName });
        return blob;
    });
}
