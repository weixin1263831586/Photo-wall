import { computePlaybackOrder } from '../playback/PlaybackOrder.js';
import { drawOverlays } from '../overlay/OverlayRenderer.js';
import { isAndroidNativeApp } from '../platform/AndroidMediaBridge.js';

/* Android 7-era WebViews and some embedded desktop runtimes do not expose
 * ResizeObserver. Install a small compatibility implementation before app.js
 * executes its bootstrap so the editor does not fail during startup. */
(function installResizeObserverCompat() {
    if (typeof window === 'undefined' || typeof window.ResizeObserver === 'function') return;
    window.ResizeObserver = class ResizeObserverCompat {
        constructor(callback) {
            this.callback = callback;
            this.targets = new Set();
            this.onResize = this.notify.bind(this);
            window.addEventListener('resize', this.onResize, { passive: true });
        }
        observe(target) {
            if (!target) return;
            this.targets.add(target);
            setTimeout(this.notify.bind(this), 0);
        }
        unobserve(target) {
            this.targets.delete(target);
        }
        disconnect() {
            this.targets.clear();
            window.removeEventListener('resize', this.onResize);
        }
        notify() {
            if (!this.targets.size) return;
            var entries = Array.from(this.targets).map(function (target) {
                return { target: target, contentRect: target.getBoundingClientRect() };
            });
            try { this.callback(entries, this); } catch (error) { console.error(error); }
        }
    };
})();

function mobileLayout() {
    return typeof window !== 'undefined' && window.matchMedia &&
        window.matchMedia('(max-width: 768px)').matches;
}

function selectedExportCategory() {
    var input = document.querySelector('input[name="export-category"]:checked');
    return input ? input.value : 'image';
}

function selectedExportFormat() {
    var input = document.querySelector('input[name="export-format"]:checked');
    return input ? input.value : 'png';
}

function isVideoExport() {
    var format = selectedExportFormat();
    return selectedExportCategory() === 'video' || format === 'mp4' || format === 'webm';
}

function makeScratchItem(base, frame, index) {
    var scratch = Object.assign({}, base);
    scratch.x = base.x + (frame.offsetsX ? Number(frame.offsetsX[index]) || 0 : 0);
    scratch.y = base.y + (frame.offsetsY ? Number(frame.offsetsY[index]) || 0 : 0);
    scratch.playbackZoom = frame.photoZooms ? Number(frame.photoZooms[index]) || 1 : 1;
    return scratch;
}

function frameProgress(frame, cellIndex) {
    if (frame.transitionProgresses) {
        var value = Number(frame.transitionProgresses[cellIndex]);
        return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    }
    return Math.max(0, Math.min(1, Number(frame.transitionProgress) || 0));
}

function paintBackground(ctx, background, width, height) {
    if (!background || background === 'transparent') return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
}

function installWallPlaybackRenderer(app) {
    var wall = app.wall;
    var manager = app.assetManager;
    if (!wall || !manager || wall.__runtimePlaybackOptimized) return;
    wall.__runtimePlaybackOptimized = true;

    var originalDrawPhoto = wall._drawPhoto.bind(wall);
    wall._drawPhoto = function (ctx, item, hovered, scale, dropTarget, imageOverride) {
        if (!item || !item.photo) return;
        var source = imageOverride ||
            (wall.videoPlayer && wall.videoPlayer.get(item.photo)) ||
            manager.peekBitmap(item.photo, 'working') ||
            manager.peekBitmap(item.photo, 'thumbnail') ||
            item.photo.img;
        return originalDrawPhoto(ctx, item, hovered, scale, dropTarget, source);
    };

    wall.renderPlaybackFrame = function (ctx, frame, options) {
        if (!this.maskData || !this.layout.length) return;
        options = options || {};
        frame = frame || { mode: 'reveal' };
        var sourceFrame = options.sourceFrame || {
            x: 0, y: 0,
            width: Math.max(1, this.cssWidth),
            height: Math.max(1, this.cssHeight)
        };
        var outputWidth = ctx.canvas.width;
        var outputHeight = ctx.canvas.height;
        var scaleX = outputWidth / Math.max(1, sourceFrame.width);
        var scaleY = outputHeight / Math.max(1, sourceFrame.height);
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, outputWidth, outputHeight);
        ctx.setTransform(scaleX, 0, 0, scaleY, -sourceFrame.x * scaleX, -sourceFrame.y * scaleY);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;

        if (this._renderOrder.length !== this.layout.length) this._refreshOrderCache();
        var renderOrder = this._renderOrder;
        for (var orderIndex = 0; orderIndex < renderOrder.length; orderIndex++) {
            var cellIndex = renderOrder[orderIndex];
            var alpha = frame.opacities ? Math.max(0, Math.min(1, frame.opacities[cellIndex] || 0)) : 1;
            if (alpha <= 0) continue;
            var cellScale = frame.scales ? Math.max(0.5, Math.min(1, frame.scales[cellIndex] || 1)) : 1;
            var item = makeScratchItem(this.layout[cellIndex], frame, cellIndex);
            var previousIndex = frame.previousIndices && Number(frame.previousIndices[cellIndex]);
            var nextIndex = frame.photoIndices && Number(frame.photoIndices[cellIndex]);
            var progress = frameProgress(frame, cellIndex);

            if (frame.mode === 'shuffle' && Number.isInteger(previousIndex) &&
                Number.isInteger(nextIndex) && previousIndex !== nextIndex) {
                var previousPhoto = this.photos[previousIndex];
                var nextPhoto = this.photos[nextIndex];
                if (previousPhoto && progress < 1) {
                    ctx.save();
                    ctx.globalAlpha = alpha * (1 - progress);
                    this._drawPhoto(ctx, Object.assign({}, item, {
                        photo: previousPhoto,
                        photoIndex: previousIndex,
                        photoId: previousPhoto.id
                    }), false, cellScale, false);
                    ctx.restore();
                }
                if (nextPhoto && progress > 0) {
                    ctx.save();
                    ctx.globalAlpha = alpha * progress;
                    this._drawPhoto(ctx, Object.assign({}, item, {
                        photo: nextPhoto,
                        photoIndex: nextIndex,
                        photoId: nextPhoto.id
                    }), false, cellScale, false);
                    ctx.restore();
                }
            } else {
                var assignedPhoto = Number.isInteger(nextIndex) ? this.photos[nextIndex] : null;
                var effective = assignedPhoto ? Object.assign({}, item, {
                    photo: assignedPhoto,
                    photoIndex: nextIndex,
                    photoId: assignedPhoto.id
                }) : item;
                ctx.save();
                ctx.globalAlpha = alpha;
                this._drawPhoto(ctx, effective, false, cellScale, false);
                ctx.restore();
            }
        }
        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(this.maskData.maskCanvas, 0, 0, this.cssWidth, this.cssHeight);
        ctx.globalCompositeOperation = 'source-over';
        drawOverlays(ctx, this.overlays, this.cssWidth, this.cssHeight, { bounds: this.getExportBounds() });
        ctx.restore();
        paintBackground(ctx, options.background, outputWidth, outputHeight);
    };

    wall.renderPlaybackFrameAsync = async function (ctx, frame, options) {
        if (!this.maskData || !this.layout.length) return;
        options = options || {};
        frame = frame || { mode: 'reveal' };
        var sourceFrame = options.sourceFrame || {
            x: 0, y: 0,
            width: Math.max(1, this.cssWidth),
            height: Math.max(1, this.cssHeight)
        };
        var outputWidth = ctx.canvas.width;
        var outputHeight = ctx.canvas.height;
        var scaleX = outputWidth / Math.max(1, sourceFrame.width);
        var scaleY = outputHeight / Math.max(1, sourceFrame.height);
        var preferThumbnail = this.photos.length > 64;
        var sourcePromises = new Map();

        function sourceFor(photo) {
            if (!photo) return Promise.resolve(null);
            /* Export rendering is paced in wall-clock time, so drawing the
               looping video element captures its live frames directly. */
            var live = wall.videoPlayer && wall.videoPlayer.get(photo);
            if (live) return Promise.resolve(live);
            var key = photo.id || photo;
            if (sourcePromises.has(key)) return sourcePromises.get(key);
            var first = preferThumbnail ? 'thumbnail' : 'working';
            var second = preferThumbnail ? 'working' : 'thumbnail';
            var promise = manager.getBitmap(photo, first)
                .catch(function () { return manager.getBitmap(photo, second); })
                .catch(function () { return photo.img || null; });
            sourcePromises.set(key, promise);
            return promise;
        }

        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, outputWidth, outputHeight);
        ctx.setTransform(scaleX, 0, 0, scaleY, -sourceFrame.x * scaleX, -sourceFrame.y * scaleY);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        if (this._renderOrder.length !== this.layout.length) this._refreshOrderCache();

        for (var orderIndex = 0; orderIndex < this._renderOrder.length; orderIndex++) {
            var cellIndex = this._renderOrder[orderIndex];
            var alpha = frame.opacities ? Math.max(0, Math.min(1, frame.opacities[cellIndex] || 0)) : 1;
            if (alpha <= 0) continue;
            var cellScale = frame.scales ? Math.max(0.5, Math.min(1, frame.scales[cellIndex] || 1)) : 1;
            var item = makeScratchItem(this.layout[cellIndex], frame, cellIndex);
            var previousIndex = frame.previousIndices && Number(frame.previousIndices[cellIndex]);
            var nextIndex = frame.photoIndices && Number(frame.photoIndices[cellIndex]);
            var progress = frameProgress(frame, cellIndex);

            if (frame.mode === 'shuffle' && Number.isInteger(previousIndex) &&
                Number.isInteger(nextIndex) && previousIndex !== nextIndex) {
                var previousPhoto = this.photos[previousIndex];
                var nextPhoto = this.photos[nextIndex];
                if (previousPhoto && progress < 1) {
                    var previousSource = await sourceFor(previousPhoto);
                    if (previousSource) {
                        ctx.save();
                        ctx.globalAlpha = alpha * (1 - progress);
                        this._drawPhoto(ctx, Object.assign({}, item, {
                            photo: previousPhoto,
                            photoIndex: previousIndex,
                            photoId: previousPhoto.id
                        }), false, cellScale, false, previousSource);
                        ctx.restore();
                    }
                }
                if (nextPhoto && progress > 0) {
                    var nextSource = await sourceFor(nextPhoto);
                    if (nextSource) {
                        ctx.save();
                        ctx.globalAlpha = alpha * progress;
                        this._drawPhoto(ctx, Object.assign({}, item, {
                            photo: nextPhoto,
                            photoIndex: nextIndex,
                            photoId: nextPhoto.id
                        }), false, cellScale, false, nextSource);
                        ctx.restore();
                    }
                }
            } else {
                var assignedPhoto = Number.isInteger(nextIndex) ? this.photos[nextIndex] : item.photo;
                var source = await sourceFor(assignedPhoto);
                if (!assignedPhoto || !source) continue;
                ctx.save();
                ctx.globalAlpha = alpha;
                this._drawPhoto(ctx, Object.assign({}, item, {
                    photo: assignedPhoto,
                    photoIndex: Number.isInteger(nextIndex) ? nextIndex : item.photoIndex,
                    photoId: assignedPhoto.id
                }), false, cellScale, false, source);
                ctx.restore();
            }
        }

        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(this.maskData.maskCanvas, 0, 0, this.cssWidth, this.cssHeight);
        ctx.globalCompositeOperation = 'source-over';
        drawOverlays(ctx, this.overlays, this.cssWidth, this.cssHeight, { bounds: this.getExportBounds() });
        ctx.restore();
        paintBackground(ctx, options.background, outputWidth, outputHeight);
    };
}

function installPlaybackPreloader(app) {
    if (app.__runtimePreloaderOptimized) return;
    app.__runtimePreloaderOptimized = true;
    app.startPlaybackBitmapPreload = function (layout) {
        var manager = app.assetManager;
        var wall = app.wall;
        if (!manager || !wall || !layout || !layout.length) return;
        var origin = app.getPlaybackOrigin ? app.getPlaybackOrigin() : null;
        var order = computePlaybackOrder(layout, app.playbackOrder, {
            canvasWidth: wall.cssWidth,
            canvasHeight: wall.cssHeight,
            seed: wall.layoutSeed,
            originX: origin ? origin.x : undefined,
            originY: origin ? origin.y : undefined,
            photos: app.photos
        });
        var photos = [];
        var seen = new Set();
        order.forEach(function (cellIndex) {
            var item = layout[cellIndex];
            var photo = item && (item.photo || app.photos[item.photoIndex]);
            if (photo && !seen.has(photo.id)) {
                seen.add(photo.id);
                photos.push(photo);
            }
        });
        app.photos.forEach(function (photo) {
            if (!seen.has(photo.id)) photos.push(photo);
        });

        var token = ++app._playbackPreloaderToken;
        var cursor = 0;
        var workers = Math.min(mobileLayout() ? 2 : 3, Math.max(1, photos.length));
        function next() {
            if (token !== app._playbackPreloaderToken || cursor >= photos.length) return Promise.resolve();
            var photo = photos[cursor++];
            return manager.getBitmap(photo, 'thumbnail')
                .catch(function () { return manager.getBitmap(photo, 'working'); })
                .catch(function () {})
                .then(next);
        }
        for (var i = 0; i < workers; i++) next();
    };
}

function installRetryUI(app) {
    document.addEventListener('error', function (event) {
        var image = event.target;
        if (!image || image.tagName !== 'IMG') return;
        var card = image.closest && image.closest('.photo-card');
        if (!card || !card.closest('#photo-library')) return;
        card.classList.add('asset-load-error');
        if (card.querySelector('.photo-retry')) return;
        var retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'photo-retry';
        retry.textContent = '↻';
        retry.title = '重新加载素材';
        retry.setAttribute('aria-label', '重新加载素材');
        card.appendChild(retry);
    }, true);

    document.addEventListener('click', function (event) {
        var retry = event.target.closest && event.target.closest('.photo-retry');
        if (!retry) return;
        event.preventDefault();
        event.stopPropagation();
        var card = retry.closest('.photo-card');
        var index = Number(card && card.getAttribute('data-index'));
        var photo = app.photos[index];
        if (!photo || !app.assetManager || typeof app.assetManager.retryPhoto !== 'function') return;
        retry.disabled = true;
        retry.textContent = '…';
        app.assetManager.retryPhoto(photo).then(function () {
            card.classList.remove('asset-load-error');
            retry.remove();
            if (app.renderPhotoLibrary) app.renderPhotoLibrary();
            if (app.wall && app.wall.refreshPhotoRendering) app.wall.refreshPhotoRendering();
            if (app.toast) app.toast('素材已重新加载');
        }).catch(function () {
            retry.disabled = false;
            retry.textContent = '↻';
            if (app.toast) app.toast('素材仍无法解码，可尝试替换文件');
        });
    }, true);
}

function addMobileSelect(sheet, label, sourceId) {
    var source = document.getElementById(sourceId);
    if (!source) return null;
    var row = document.createElement('label');
    row.className = 'mobile-playback-row';
    var name = document.createElement('span');
    name.textContent = label;
    var clone = source.cloneNode(true);
    clone.id = 'mobile-' + sourceId;
    clone.removeAttribute('disabled');
    clone.value = source.value;
    clone.addEventListener('change', function () {
        source.value = clone.value;
        source.dispatchEvent(new Event('change', { bubbles: true }));
    });
    source.addEventListener('change', function () { clone.value = source.value; });
    row.append(name, clone);
    sheet.appendChild(row);
    return clone;
}

function installMobilePlaybackSheet(app) {
    var controls = document.getElementById('canvas-motion-controls');
    if (!controls || document.getElementById('mobile-playback-settings-btn')) return;
    var button = document.createElement('button');
    button.id = 'mobile-playback-settings-btn';
    button.className = 'canvas-control-btn mobile-playback-settings-btn';
    button.type = 'button';
    button.innerHTML = '<span aria-hidden="true">⚙</span><span>播放设置</span>';
    button.setAttribute('aria-haspopup', 'dialog');
    controls.appendChild(button);

    var backdrop = document.createElement('div');
    backdrop.id = 'mobile-playback-settings-backdrop';
    backdrop.className = 'mobile-playback-settings-backdrop';
    backdrop.hidden = true;
    var sheet = document.createElement('section');
    sheet.id = 'mobile-playback-settings';
    sheet.className = 'mobile-playback-settings';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', '播放设置');
    sheet.hidden = true;
    var header = document.createElement('div');
    header.className = 'mobile-playback-header';
    header.innerHTML = '<strong>播放设置</strong><button type="button" aria-label="关闭">×</button>';
    sheet.appendChild(header);
    var clones = [
        addMobileSelect(sheet, '模式', 'playback-mode'),
        addMobileSelect(sheet, '顺序', 'playback-order'),
        addMobileSelect(sheet, '转场', 'playback-transition'),
        addMobileSelect(sheet, '速度', 'flow-speed')
    ].filter(Boolean);
    backdrop.appendChild(sheet);
    document.body.appendChild(backdrop);

    function syncDisabled() {
        clones.forEach(function (clone) {
            var original = document.getElementById(clone.id.replace(/^mobile-/, ''));
            clone.disabled = Boolean(original && original.disabled);
            if (original) clone.value = original.value;
        });
    }
    function open() {
        if (!mobileLayout()) return;
        syncDisabled();
        backdrop.hidden = false;
        sheet.hidden = false;
        document.body.classList.add('mobile-playback-sheet-open');
        var first = sheet.querySelector('select:not([disabled])');
        if (first) first.focus();
    }
    function close() {
        backdrop.hidden = true;
        sheet.hidden = true;
        document.body.classList.remove('mobile-playback-sheet-open');
        if (mobileLayout()) button.focus();
    }
    button.addEventListener('click', open);
    header.querySelector('button').addEventListener('click', close);
    backdrop.addEventListener('click', function (event) { if (event.target === backdrop) close(); });
    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && !sheet.hidden) close();
    });

    var originalUpdateActionState = app.updateActionState;
    app.updateActionState = function () {
        var result = originalUpdateActionState.apply(app, arguments);
        var order = document.getElementById('playback-order');
        var orderLabel = order && order.closest('.flow-speed-field');
        if (orderLabel) orderLabel.style.display = app.photos.length ? '' : 'none';
        syncDisabled();
        return result;
    };
    app.updateActionState();
}

function installExportProgress(app) {
    var loading = document.getElementById('loading-overlay');
    if (!loading || document.getElementById('video-export-progress-panel')) return;
    var panel = document.createElement('div');
    panel.id = 'video-export-progress-panel';
    panel.className = 'video-export-progress-panel';
    panel.hidden = true;
    panel.innerHTML = '<div class="video-export-progress-copy"><strong>正在导出视频</strong><span id="video-export-progress-value">0%</span></div>' +
        '<div class="video-export-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>' +
        '<button id="video-export-cancel" type="button">取消导出</button>';
    loading.appendChild(panel);
    var track = panel.querySelector('.video-export-progress-track');
    var fill = track.querySelector('i');
    var value = panel.querySelector('#video-export-progress-value');
    var cancel = panel.querySelector('#video-export-cancel');
    var controller = null;
    var cancelledAt = 0;

    function startController() {
        controller = window.__PHOTO_WALL_EXPORT_ABORT_CONTROLLER__ || new AbortController();
        window.__PHOTO_WALL_EXPORT_ABORT_CONTROLLER__ = controller;
        window.__PHOTO_WALL_EXPORT_ABORT_SIGNAL__ = controller.signal;
    }

    document.addEventListener('click', function (event) {
        if (!event.target.closest || !event.target.closest('#export-confirm')) return;
        if (!isVideoExport()) return;
        startController();
    }, true);

    cancel.addEventListener('click', function () {
        if (!controller || controller.signal.aborted) return;
        cancelledAt = Date.now();
        cancel.disabled = true;
        cancel.textContent = '正在取消…';
        controller.abort();
    });

    window.addEventListener('photowall:video-export-start', function () {
        panel.hidden = false;
        cancel.disabled = false;
        cancel.textContent = '取消导出';
        fill.style.width = '0%';
        value.textContent = '0%';
        track.classList.remove('indeterminate');
    });
    window.addEventListener('photowall:video-export-status', function (event) {
        var message = event.detail && event.detail.message;
        if (message) panel.querySelector('strong').textContent = message;
    });
    window.addEventListener('photowall:video-export-progress', function (event) {
        var detail = event.detail || {};
        var percent = Math.max(0, Math.min(100, Number(detail.percent) || 0));
        panel.hidden = false;
        track.classList.toggle('indeterminate', detail.indeterminate === true);
        track.setAttribute('aria-valuenow', String(Math.round(percent)));
        fill.style.width = percent + '%';
        value.textContent = detail.indeterminate ? '处理中' : Math.round(percent) + '%';
    });
    window.addEventListener('photowall:video-export-end', function (event) {
        var cancelled = event.detail && event.detail.cancelled;
        setTimeout(function () { panel.hidden = true; }, cancelled ? 200 : 450);
        if (cancelled && app.toast) app.toast('视频导出已取消');
        controller = null;
    });

    // Replace only the generic failure toast immediately after a user cancel.
    if (typeof app.toast === 'function' && !app.__runtimeToastWrapped) {
        app.__runtimeToastWrapped = true;
        var originalToast = app.toast;
        app.toast = function (message) {
            if (Date.now() - cancelledAt < 2500 && /视频.*(失败|错误)|导出失败/.test(String(message || ''))) {
                return originalToast.call(app, '视频导出已取消');
            }
            return originalToast.apply(app, arguments);
        };
    }
}

function installExportUI(app) {
    var android = isAndroidNativeApp();
    var preset = document.getElementById('export-video-preset');
    if (preset && !preset.querySelector('[value="portrait-720"]')) {
        var additions = [
            ['portrait-720', '竖屏 720 × 1280（推荐）'],
            ['landscape-720', '横屏 1280 × 720（推荐）'],
            ['square-720', '方形 720 × 720（推荐）']
        ];
        additions.reverse().forEach(function (entry) {
            var option = document.createElement('option');
            option.value = entry[0];
            option.textContent = entry[1];
            preset.insertBefore(option, preset.firstChild);
        });
    }
    if (android) {
        var webm = document.querySelector('input[name="export-format"][value="webm"]');
        if (webm && webm.closest('label')) webm.closest('label').hidden = true;
        var field = document.getElementById('video-format-field');
        if (field && !field.querySelector('.android-video-export-hint')) {
            var hint = document.createElement('p');
            hint.className = 'android-video-export-hint';
            hint.textContent = 'Android 使用 MediaCodec / Media3 导出 H.264 MP4';
            field.appendChild(hint);
        }
    }

    function syncCopy() {
        var category = selectedExportCategory();
        var title = document.getElementById('export-title');
        var subtitle = document.querySelector('#export-dialog .modal-header p');
        if (title) title.textContent = category === 'video' ? '导出视频' : category === 'pdf' ? '导出 PDF' : '导出图片';
        if (subtitle) subtitle.textContent = category === 'video' ?
            '选择播放方式、画面尺寸和输出格式' :
            category === 'pdf' ? '选择适合打印的纸张、精度与出血设置' : '选择适合分享或打印的输出设置';
        if (android && category === 'video') {
            var mp4 = document.querySelector('input[name="export-format"][value="mp4"]');
            if (mp4) mp4.checked = true;
        }
    }

    document.addEventListener('change', function (event) {
        if (event.target.matches('input[name="export-category"], input[name="export-format"]')) syncCopy();
    });
    document.addEventListener('click', function (event) {
        if (!event.target.closest) return;
        if (event.target.closest('#export-btn')) setTimeout(syncCopy, 0);
    }, true);
    syncCopy();
}

function installStyles() {
    if (document.getElementById('runtime-optimization-style')) return;
    var style = document.createElement('style');
    style.id = 'runtime-optimization-style';
    style.textContent = `
.photo-card.asset-load-error::after{content:'素材加载失败';position:absolute;left:3px;right:3px;bottom:3px;padding:2px;border-radius:5px;background:rgba(12,12,18,.86);color:#ff9aaa;font-size:8px;text-align:center;pointer-events:none}
.photo-retry{position:absolute;z-index:5;inset:50% auto auto 50%;transform:translate(-50%,-50%);width:30px;height:30px;border:1px solid rgba(255,255,255,.45);border-radius:50%;background:rgba(15,15,22,.9);color:#fff;font-size:18px;cursor:pointer}.photo-retry:disabled{opacity:.6}
.video-export-progress-panel{width:min(360px,calc(100vw - 40px));padding:15px;border:1px solid rgba(255,255,255,.13);border-radius:12px;background:#181824;box-shadow:0 12px 40px rgba(0,0,0,.32)}
.video-export-progress-copy{display:flex;justify-content:space-between;gap:14px;margin-bottom:10px;font-size:12px}.video-export-progress-copy span{color:#9d8fff;white-space:nowrap}
.video-export-progress-track{height:7px;overflow:hidden;border-radius:9px;background:rgba(255,255,255,.1)}.video-export-progress-track i{display:block;width:0;height:100%;border-radius:inherit;background:#7c6cf0;transition:width .18s}.video-export-progress-track.indeterminate i{width:38%!important;animation:pw-progress 1s ease-in-out infinite}@keyframes pw-progress{0%{transform:translateX(-110%)}100%{transform:translateX(290%)}}
#video-export-cancel{display:block;margin:13px auto 0;padding:7px 16px;border:1px solid #45455b;border-radius:8px;background:transparent;color:#ddd;cursor:pointer}#video-export-cancel:disabled{opacity:.55}
.android-video-export-hint{margin-top:8px;color:#60e1be;font-size:10px}
.mobile-playback-settings-btn,.mobile-playback-settings-backdrop{display:none}
@media(max-width:768px){.canvas-motion-controls .flow-speed-field{display:none!important}.mobile-playback-settings-btn{display:inline-flex!important}.mobile-playback-settings-btn span:last-child{display:none}.mobile-playback-settings-backdrop{display:flex;position:fixed;z-index:2400;inset:0;align-items:flex-end;background:rgba(0,0,0,.55)}.mobile-playback-settings-backdrop[hidden]{display:none!important}.mobile-playback-settings{width:100%;padding:16px 16px max(18px,env(safe-area-inset-bottom));border-radius:18px 18px 0 0;background:#181824;border-top:1px solid #333345}.mobile-playback-settings[hidden]{display:none!important}.mobile-playback-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}.mobile-playback-header strong{font-size:16px}.mobile-playback-header button{width:40px;height:40px;border:0;border-radius:50%;background:#242435;color:#fff;font-size:22px}.mobile-playback-row{display:grid;grid-template-columns:70px 1fr;align-items:center;gap:12px;margin-top:10px;color:#aaaabd}.mobile-playback-row select{width:100%;min-height:44px;padding:0 10px;border:1px solid #363648;border-radius:9px;background:#111119;color:#eee}.photo-retry{width:34px;height:34px}.android-video-export-hint{font-size:11px}}
`;
    document.head.appendChild(style);
}

function install(app) {
    if (!app || app.__runtimeOptimizationInstalled || !app.wall || !app.assetManager) return false;
    app.__runtimeOptimizationInstalled = true;
    installStyles();
    /* Playback rendering now lives in PhotoWall itself. Do not replace core
       methods at runtime: fixes in photowall.js must be the code that runs. */
    installPlaybackPreloader(app);
    installRetryUI(app);
    installMobilePlaybackSheet(app);
    installExportProgress(app);
    installExportUI(app);
    return true;
}

export function scheduleRuntimeOptimization(app) {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    var attempts = 0;
    function tryInstall() {
        if (install(app)) return;
        attempts++;
        if (attempts < 120) setTimeout(tryInstall, 50);
    }
    setTimeout(tryInstall, 0);
}
