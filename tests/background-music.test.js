import test from 'node:test';
import assert from 'node:assert/strict';
import { musicVolumeAt, normalizeBackgroundMusic } from '../js/audio/BackgroundMusic.js';

test('background music settings are normalized safely', function () {
    var music = normalizeBackgroundMusic({
        name: 'song.mp3', duration: 20, volume: 2, startTime: 99,
        fadeIn: -2, fadeOut: 30, loop: false
    });
    assert.equal(music.volume, 1);
    assert.ok(music.startTime < 20);
    assert.equal(music.fadeIn, 0);
    assert.equal(music.fadeOut, 10);
    assert.equal(music.loop, false);
    assert.equal(music.endTime, 20);
});

test('music selection clamps to a valid start/end segment', function () {
    var music = normalizeBackgroundMusic({ duration: 30, startTime: 8, endTime: 18 });
    assert.equal(music.startTime, 8);
    assert.equal(music.endTime, 18);
    assert.equal(music.endTime - music.startTime, 10);
});

test('background music volume follows fade-in and fade-out', function () {
    var music = { duration: 20, volume: 0.8, fadeIn: 2, fadeOut: 2 };
    assert.equal(musicVolumeAt(music, 0, 10), 0);
    assert.ok(Math.abs(musicVolumeAt(music, 1, 10) - 0.4) < 0.001);
    assert.ok(Math.abs(musicVolumeAt(music, 5, 10) - 0.8) < 0.001);
    assert.ok(Math.abs(musicVolumeAt(music, 9, 10) - 0.4) < 0.001);
});
