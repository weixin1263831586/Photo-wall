import { musicVolumeAt, normalizeBackgroundMusic } from '../audio/BackgroundMusic.js';
import { BUILT_IN_MUSIC, createBuiltInMusicFile } from '../audio/BuiltInMusic.js';

/** Installs the background-music feature without coupling it to app bootstrap. */
export function installMusicController(app) {
    app.formatMediaTime = function (seconds) {
        seconds = Math.max(0, Number(seconds) || 0);
        var minutes = Math.floor(seconds / 60);
        return minutes + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');
    };

    app.renderBuiltInMusic = function () {
        var library = document.getElementById('music-library');
        if (!library) return;
        library.innerHTML = BUILT_IN_MUSIC.map(function (track) {
            return '<button class="music-library-item" type="button" data-music-track="' +
                app.escapeHTML(track.id) + '" style="--music-color:' + app.escapeHTML(track.color) + '">' +
                '<span class="music-library-color" aria-hidden="true"></span><span class="music-library-copy"><strong>' +
                app.escapeHTML(track.name) + '</strong><small>' + app.escapeHTML(track.mood) + '</small></span></button>';
        }).join('');
    };

    app.useBuiltInMusic = function (id) {
        if (app._builtInMusicBusy) return;
        app._builtInMusicBusy = true;
        var button = document.querySelector('[data-music-track="' + id + '"]');
        if (button) button.classList.add('active');
        app.showLoading(true, '正在生成内置配乐…');
        createBuiltInMusicFile(id).then(function (file) {
            app.showLoading(false);
            app.loadBackgroundMusic(file);
        }).catch(function (error) {
            app.showLoading(false);
            if (button) button.classList.remove('active');
            console.error(error);
            app.toast('内置配乐生成失败');
        }).finally(function () {
            app._builtInMusicBusy = false;
        });
    };

    app.releaseMusicAudio = function () {
        if (app.musicAudio) {
            app.musicAudio.pause();
            app.musicAudio.removeAttribute('src');
            app.musicAudio.load();
        }
        app.musicAudio = null;
        app.musicStandalonePreview = false;
        if (app.musicObjectURL) URL.revokeObjectURL(app.musicObjectURL);
        app.musicObjectURL = '';
    };

    app.attachMusicAudio = function () {
        app.releaseMusicAudio();
        if (!app.backgroundMusic || !(app.backgroundMusic.originalBlob instanceof Blob)) return;
        app.musicObjectURL = URL.createObjectURL(app.backgroundMusic.originalBlob);
        app.musicAudio = new Audio(app.musicObjectURL);
        app.musicAudio.preload = 'auto';
        app.musicAudio.addEventListener('ended', function () {
            if (!app.backgroundMusic || app.backgroundMusic.loop || app.flowPlaying) return;
            app.musicStandalonePreview = false;
            app.syncMusicControls();
        });
        app.musicAudio.addEventListener('timeupdate', function () {
            var music = app.backgroundMusic;
            if (!music || !app.musicAudio || app.musicAudio.currentTime < music.endTime) return;
            if (music.loop && !app.musicAudio.paused) app.musicAudio.currentTime = music.startTime;
            else app.stopMusicPlayback();
        });
    };

    app.loadBackgroundMusic = function (file) {
        var valid = /^audio\//i.test(file.type) || /\.(mp3|wav|m4a|aac|ogg)$/i.test(file.name || '');
        if (!valid || file.size > 80 * 1024 * 1024) {
            app.toast(valid ? '音乐文件不能超过 80 MB' : '请选择 MP3、WAV、M4A、AAC 或 OGG 音乐');
            return;
        }
        app.releaseMusicAudio();
        var probeURL = URL.createObjectURL(file);
        var probe = new Audio(probeURL);
        probe.preload = 'metadata';
        var settled = false;
        var probeTimer = setTimeout(function () {
            if (settled) return;
            finish();
            app.toast('音乐读取超时，请尝试其他格式');
        }, 10000);
        function finish() {
            if (settled) return false;
            settled = true;
            clearTimeout(probeTimer);
            URL.revokeObjectURL(probeURL);
            probe.removeAttribute('src');
            probe.load();
            return true;
        }
        function commit(duration) {
            app.recordHistory();
            app.backgroundMusic = normalizeBackgroundMusic({
                name: file.name, type: file.type || 'audio/mpeg', duration: duration,
                volume: 0.7, startTime: 0, endTime: duration, loop: duration > 0,
                fadeIn: 1, fadeOut: 1, originalBlob: file
            });
            app.attachMusicAudio();
            app.syncMusicControls();
            if (app.autosave) app.autosave.schedule();
            app.toast(duration > 0 ? '背景音乐已添加' :
                '背景音乐已添加，但无法读取时长；循环播放已停用');
        }
        probe.addEventListener('loadedmetadata', function () {
            if (settled) return;
            var duration = Number.isFinite(probe.duration) ? probe.duration : 0;
            if (!finish()) return;
            commit(duration);
        }, { once: true });
        probe.addEventListener('error', function () {
            if (settled) return;
            finish();
            app.toast('音乐无法读取，请尝试其他格式');
        }, { once: true });
    };

    app.removeBackgroundMusic = function () {
        if (!app.backgroundMusic) return;
        app.recordHistory();
        app.stopMusicPlayback();
        app.releaseMusicAudio();
        app.backgroundMusic = null;
        app.syncMusicControls();
        if (app.autosave) app.autosave.schedule();
        app.toast('背景音乐已移除');
    };

    app.updateBackgroundMusicSettings = function () {
        if (!app.backgroundMusic) return;
        app.backgroundMusic = normalizeBackgroundMusic(Object.assign({}, app.backgroundMusic, {
            volume: document.getElementById('music-volume').value,
            startTime: document.getElementById('music-start').value,
            endTime: document.getElementById('music-end').value,
            fadeIn: document.getElementById('music-fade-in').value,
            fadeOut: document.getElementById('music-fade-out').value,
            loop: document.getElementById('music-loop').checked
        }));
        if (app.musicAudio) {
            app.musicAudio.loop = false;
            app.musicAudio.volume = app.backgroundMusic.volume;
            if (document.activeElement === document.getElementById('music-start')) {
                app.musicAudio.currentTime = app.backgroundMusic.startTime;
            }
        }
        app.syncMusicControls();
        if (app.autosave) app.autosave.schedule();
    };

    app.syncMusicControls = function () {
        var music = app.backgroundMusic;
        document.getElementById('music-editor').hidden = !music;
        document.getElementById('music-remove-btn').hidden = !music;
        document.getElementById('music-upload-btn').textContent = music ? '更换音乐' : '＋ 上传本地音乐';
        if (!music) {
            document.querySelectorAll('[data-music-track]').forEach(function (button) { button.classList.remove('active'); });
            return;
        }
        document.getElementById('music-name').textContent = music.name;
        document.getElementById('music-duration').textContent = app.formatMediaTime(music.duration);
        document.getElementById('music-volume').value = music.volume;
        document.getElementById('music-volume-value').textContent = Math.round(music.volume * 100) + '%';
        var start = document.getElementById('music-start');
        start.max = Math.max(0, music.duration - 0.05);
        start.value = music.startTime;
        document.getElementById('music-start-value').textContent = app.formatMediaTime(music.startTime);
        var end = document.getElementById('music-end');
        end.min = Math.min(music.duration, music.startTime + 0.05);
        end.max = music.duration;
        end.value = music.endTime;
        document.getElementById('music-end-value').textContent = app.formatMediaTime(music.endTime);
        document.getElementById('music-fade-in').value = music.fadeIn;
        document.getElementById('music-fade-out').value = music.fadeOut;
        document.getElementById('music-loop').checked = music.loop;
        document.getElementById('music-preview-btn').textContent = app.musicStandalonePreview ? '■ 停止试听' : '▶ 试听';
        document.querySelectorAll('[data-music-track]').forEach(function (button) {
            button.classList.toggle('active', music.name === button.getAttribute('data-music-track') + '.wav');
        });
    };

    app.startMusicPlayback = function (timelineDurationMs, standalone) {
        if (!app.backgroundMusic || !app.musicAudio) return;
        var music = app.backgroundMusic;
        try { app.musicAudio.currentTime = Math.min(music.startTime, Math.max(0, music.duration - 0.05)); } catch (ignore) {}
        app.musicAudio.loop = false;
        app.musicAudio.volume = standalone ? music.volume : musicVolumeAt(music, 0, timelineDurationMs / 1000);
        app.musicStandalonePreview = standalone === true;
        app.musicPlaybackStartedAt = performance.now();
        app.musicAudio.play().catch(function () {
            app.musicStandalonePreview = false;
            app.musicPlaybackStartedAt = 0;
            app.syncMusicControls();
            app.toast('浏览器阻止了音乐播放，请再次点击播放');
        });
        app.syncMusicControls();
    };

    app.stopMusicPlayback = function () {
        if (app.musicAudio) app.musicAudio.pause();
        app.musicStandalonePreview = false;
        app.musicPlaybackStartedAt = 0;
        app.syncMusicControls();
    };

    app.updateMusicPlayback = function (elapsedMs, totalMs) {
        if (!app.musicAudio || !app.backgroundMusic || app.musicStandalonePreview) return;
        if (app.musicAudio.currentTime >= app.backgroundMusic.endTime) {
            if (app.backgroundMusic.loop) app.musicAudio.currentTime = app.backgroundMusic.startTime;
            else app.musicAudio.pause();
        }
        var elapsed = app.musicPlaybackStartedAt ? performance.now() - app.musicPlaybackStartedAt : elapsedMs;
        app.musicAudio.volume = musicVolumeAt(app.backgroundMusic, elapsed / 1000, totalMs / 1000);
    };

    app.toggleMusicPreview = function () {
        if (!app.backgroundMusic) return;
        if (app.musicStandalonePreview && app.musicAudio && !app.musicAudio.paused) app.stopMusicPlayback();
        else app.startMusicPlayback(0, true);
    };
}
