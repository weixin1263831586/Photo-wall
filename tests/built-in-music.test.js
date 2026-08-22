import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILT_IN_MUSIC, createBuiltInMusicFile, getBuiltInMusic } from '../js/audio/BuiltInMusic.js';

test('built-in music catalog has unique reusable tracks', function () {
    assert.ok(BUILT_IN_MUSIC.length >= 12);
    assert.equal(new Set(BUILT_IN_MUSIC.map(function (track) { return track.id; })).size, BUILT_IN_MUSIC.length);
    assert.equal(getBuiltInMusic('warm-memory').name, '温暖回忆');
    BUILT_IN_MUSIC.forEach(function (track) {
        assert.ok(track.bpm >= 60 && track.bpm <= 140);
        assert.equal(track.progression.length, 4);
        assert.equal(track.melody.length, 8);
    });
});

test('built-in music synthesizer creates a valid WAV file', async function () {
    var file = await createBuiltInMusicFile('warm-memory', { duration: 4, sampleRate: 8000 });
    var bytes = new Uint8Array(await file.arrayBuffer());
    assert.equal(new TextDecoder().decode(bytes.subarray(0, 4)), 'RIFF');
    assert.equal(new TextDecoder().decode(bytes.subarray(8, 12)), 'WAVE');
    assert.ok(bytes.byteLength > 64000);
});
