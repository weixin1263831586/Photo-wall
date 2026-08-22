import { Shapes, ShapeFactory } from './shapes.js';
import { PhotoWall } from './photowall.js';
import {
    LAYOUT_PRESETS,
    applyLayoutPreset,
    layoutPresetMatches
} from './layout/LayoutPresets.js';
import { createTemplateLibrary } from './layout/TemplateLibrary.js';
import { analyzePhoto } from './image/PhotoAnalyzer.js';
import { createPhotoAssetManager } from './image/PhotoAssetManager.js';
import { refineSubjectFocus } from './image/SubjectFocus.js';
import { readCaptureTime } from './image/ExifMetadata.js';
import { addRoundedRectPath, applyPhotoTransform, drawPhotoCover, normalizePhotoTransform } from './image/PhotoTransform.js';
import { createOverlay, normalizeOverlays } from './overlay/OverlayRenderer.js';
import { createPlaybackController } from './controllers/PlaybackController.js';
import { installMusicController } from './controllers/MusicController.js';
import { PLAYBACK_ORDER_KEYS, PlaybackOrderLabels } from './playback/PlaybackOrder.js';
import { recordTimelineCanvas, pickVideoMimeType } from './video/VideoRecorder.js';
import { createWallVideoPlayer } from './video/WallVideoPlayer.js';
import { resolveVideoExportDimensions } from './video/VideoExportPresets.js';
import { normalizeBackgroundMusic } from './audio/BackgroundMusic.js';
import { createPhotoAnalysisWorkerClient } from './image/PhotoAnalysisWorkerClient.js';
import { createPhotoLibrary } from './ui/PhotoLibrary.js';
import { createHistoryManager } from './history/HistoryManager.js';
import { createProjectAutosave } from './persistence/ProjectAutosave.js';
import {
    createProjectContainer,
    isPhotowallContainer,
    migrateProject,
    openProjectContainer
} from './persistence/ProjectContainer.js';
import { isNativeApp, openBlobWithSystem, saveBlob, cleanupPlayCache } from './platform/NativeFileService.js';
import { isAndroidNativeApp, transcodeVideoForAndroidPlayback } from './platform/AndroidMediaBridge.js';
import { checkAndInstallUpdate, installCrashCapture } from './platform/RuntimeServices.js';
import { createDeviceProfile, getImportDimension } from './platform/DeviceProfile.js';
import {
    assessPrintResolution,
    createPrintPdf,
    getPrintPreset,
    printPixelDimensions
} from './export/PrintExport.js';

/**
 * App controller — wires UI to PhotoWall engine.
 */
'use strict';

    var app = {
        wall: null,
        photos: [],
        overlays: [],
        selectedOverlayId: null,
        overlayEditSnapshot: null,
        musicEditSnapshot: null,
        lightboxIndex: -1,
        resizeTimer: null,
        densityTimer: null,
        overlapTimer: null,
        rotationTimer: null,
        exportPreviewRAF: null,
        exportReturnFocus: null,
        shapeEditorReturnFocus: null,
        lightboxReturnFocus: null,
        lightboxObjectURL: '',
        lightboxTranscodedURL: '',
        lightboxTranscodeToken: 0,
        localAdjustSnapshot: null,
        localAdjustCommitTimer: null,
        flowPlaying: false,
        flowTimer: null,
        flowSnapshot: null,
        flowCycleCount: 0,
        playbackMode: 'shuffle',
        playbackOrder: 'center-out',
        playbackTransition: 'zoom',
        revealTimeline: null,
        revealRAF: null,
        revealStartTime: 0,
        customOrigin: null,
        backgroundMusic: null,
        musicObjectURL: '',
        musicAudio: null,
        musicStandalonePreview: false,
        musicPlaybackStartedAt: 0,
        photoEditorIndex: -1,
        photoEditorDraft: null,
        photoEditorReplacement: null,
        photoEditorRenderToken: 0,
        photoEditorReturnFocus: null,
        currentShapeKey: 'china',
        pendingShapeImage: null,
        shapePreviewRAF: null,
        maskStrokes: [],
        maskBrushMode: 'keep',
        maskBrushPointerId: null,
        maskPreviewMeta: null,
        sourcePreviewMeta: null,
        shapeCrop: { x: 0, y: 0, width: 1, height: 1 },
        shapeCropStart: null,
        shapeCropPointerId: null,
        history: null,
        autosave: null,
        autosaveRestoring: false,
        photoLibrary: null,
        photoAnalyzerWorker: null,
        assetManager: null,
        templateLibrary: null,
        deviceProfile: null,
        maxPhotos: 1000,
        maxFileSize: 40 * 1024 * 1024,
        maxVideoFileSize: 200 * 1024 * 1024,
        maxPhotoDimension: 1600,
        photoLoadConcurrency: 3,
        photoLoadTimeout: 30000,
        supportedImageTypes: ['image/jpeg', 'image/png', 'image/webp'],
        supportedVideoTypes: [
            'video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v',
            'video/x-matroska', 'video/x-msvideo', 'video/3gpp', 'video/mpeg'
        ]
    };

    app._fileLoadToken = 0;
    app.videoCompatibilityQueue = Promise.resolve();

    app.playbackController = createPlaybackController(app);
    installMusicController(app);

    /* ------------------------------------------------------------------ *
     *  Init
     * ------------------------------------------------------------------ */

    app.init = function () {
        app.detachCrashCapture = installCrashCapture();
        /* Best-effort cleanup of stale system-player cache files. */
        cleanupPlayCache();
        var canvas = document.getElementById('wall-canvas');
        app.deviceProfile = createDeviceProfile({
            viewportWidth: window.innerWidth,
            coarsePointer: window.matchMedia('(pointer: coarse)').matches,
            mobile: isAndroidNativeApp(),
            deviceMemory: navigator.deviceMemory,
            hardwareConcurrency: navigator.hardwareConcurrency
        });
        app.photoLoadConcurrency = app.deviceProfile.photoLoadConcurrency;
        app.maxPhotoDimension = app.deviceProfile.maxPhotoDimension;
        app.assetManager = createPhotoAssetManager({
            thumbnailDimension: app.deviceProfile.thumbnailDimension,
            maxWorkingEntries: app.deviceProfile.maxWorkingBitmaps,
            maxWorkingPixels: app.deviceProfile.maxWorkingBitmapPixels,
            maxThumbnailEntries: Math.min(app.maxPhotos, app.deviceProfile.recommendedPhotoCount * 2),
            maxThumbnailPixels: app.deviceProfile.mobile ? 32000000 : 80000000,
            maxOriginalEntries: app.deviceProfile.maxOriginalBitmaps,
            maxOriginalPixels: app.deviceProfile.maxOriginalBitmapPixels
        });
        app.templateLibrary = createTemplateLibrary();
        app.videoPlayer = createWallVideoPlayer({
            maxConcurrent: app.deviceProfile.mobile ? 4 : 10,
            rotationInterval: app.deviceProfile.mobile ? 9000 : 12000,
            onActivity: function () { if (app.wall) app.wall._ensureVideoLoop(); },
            onDecodeError: function (photo) {
                /* A WebView may decode the poster yet fail once continuous
                   playback begins. Close that gap by sending the original to
                   the same Android H.264 compatibility queue. */
                if (!isAndroidNativeApp() || !photo || photo.playbackBlob ||
                    !(photo.originalBlob instanceof Blob)) return;
                photo.playbackStatus = 'decode-error';
                if (app.renderPhotoLibrary) app.renderPhotoLibrary();
                setTimeout(function () {
                    if (app.photos.indexOf(photo) >= 0) app.prepareIncompatibleVideos([photo]);
                }, 0);
            }
        });
        app.wall = new PhotoWall(canvas, {
            maxDevicePixelRatio: app.deviceProfile.maxEditorDpr,
            assetManager: app.assetManager,
            videoPlayer: app.videoPlayer
        });
        document.documentElement.classList.toggle('mobile-device', app.deviceProfile.mobile);
        app.photoAnalyzerWorker = createPhotoAnalysisWorkerClient({
            timeout: app.photoLoadTimeout,
            workers: app.deviceProfile.analysisWorkers
        });
        app.history = createHistoryManager({
            limit: app.deviceProfile.historyLimit,
            capture: function () { return app.captureState(); },
            restore: function (state) { app.restoreState(state); },
            onChange: function () {
                app.updateActionState();
            }
        });
        app.autosave = createProjectAutosave({
            delay: app.deviceProfile.mobile ? 2500 : 1500,
            backupLimit: app.deviceProfile.mobile ? 2 : 5,
            maxBackupBytes: app.deviceProfile.mobile ? 256 * 1024 * 1024 : 1024 * 1024 * 1024,
            capture: function () { return app.captureAutosaveSnapshot(); },
            onError: function (error) { console.warn('自动保存失败:', error); }
        });
        app.photoLibrary = createPhotoLibrary({
            onReorder: app.reorderPhoto,
            onFeature: app.toggleFeaturedPhoto,
            onEdit: app.openPhotoEditor,
            onRemove: app.removePhoto,
            onOpen: app.openLightbox
        });
        app.wall.onPhotoClick = function (item) {
            var photoIndex = item && Number.isInteger(item.photoIndex) ? item.photoIndex :
                app.photos.findIndex(function (photo) { return item && item.photo && photo.id === item.photo.id; });
            if (photoIndex >= 0) app.openLightbox(photoIndex);
        };
        app.wall.onBeforeSwap = function () {
            app.recordHistory();
        };
        app.wall.onSwap = function () {
            app.toast('已交换两张照片的位置');
            app.updateActionState();
        };
        app.wall.onBeforeLocalAdjust = app.beginLocalAdjust;
        app.wall.onLocalAdjust = function () {
            app.commitLocalAdjust('已调整当前格位中的照片位置');
        };
        app.wall.onLocalAdjustSelect = function () {
            app.updateLocalAdjustControls();
        };
        app.wall.onLayout = function (slotCount, largeCount) {
            var status = document.getElementById('canvas-status');
            if (!status) return;
            status.textContent = app.photos.length ?
                app.photos.length + ' 个素材 · ' + slotCount + ' 个填充格位' +
                    (largeCount ? ' · ' + largeCount + ' 个大图' : '') + ' · 本地处理' :
                '所有素材仅在本地处理';
            app.updateExportDimensions();
            app.updateLayoutPresetSelection();
            app.updateLocalAdjustControls();
        };
        app.wall.onOverlaySelect = function (id) {
            app.selectedOverlayId = id;
            app.renderLayers();
        };
        app.wall.onBeforeOverlayMove = function () { app.recordHistory(); };
        app.wall.onOverlayMove = function () {
            app.renderLayers();
            if (app.autosave) app.autosave.schedule();
        };
        app.wall.setOverlays(app.overlays);

        app.wall.setShape('china');

        /* Ensure the canvas picks up its real dimensions on first paint.
         * requestAnimationFrame can fire before the flexbox parent settles,
         * leaving the canvas at its 300×150 default. A ResizeObserver plus a
         * deferred fallback guarantees a resize once layout is ready. */
        var stage = document.getElementById('canvas-stage');
        if (typeof ResizeObserver === 'function') {
            app._canvasResizeObserver = new ResizeObserver(function () {
                clearTimeout(app.resizeTimer);
                app.resizeTimer = setTimeout(function () {
                    /* A rebuild during playback would leave the running timeline
                       driving a brand-new layout (mismatched cell indices). */
                    if (app.flowPlaying || app.revealTimeline) app.stopAllPlayback(true);
                    app.wall.resize();
                    app.updateCustomOriginMarker();
                }, 80);
            });
            app._canvasResizeObserver.observe(stage);
        }
        requestAnimationFrame(function () { app.wall.resize(); });
        setTimeout(function () {
            if (!app.wall.cssWidth || app.wall.cssWidth <= 100) {
                app.wall.resize();
                app.updateCustomOriginMarker();
            }
        }, 200);

        app.bindUI();
        app.renderBuiltInMusic();
        app.syncMusicControls();
        app.renderLayoutPresets();
        app.renderLayers();
        app.renderShapeButtons();
        app.updateModeHint();
        app.photoLibrary.bind();
        app.bindShapeCrop();
        app.updateActionState();
        app.tryRestoreAutosave();
        if (isNativeApp() && import.meta.env.VITE_PHOTO_WALL_UPDATES === 'true') {
            setTimeout(function () { app.checkForUpdates(true); }, 5000);
        }

        window.addEventListener('resize', function () {
            clearTimeout(app.resizeTimer);
            app.resizeTimer = setTimeout(function () {
                if (app.flowPlaying || app.revealTimeline) app.stopAllPlayback(true);
                app.wall.resize();
                app.updateCustomOriginMarker();
            }, 200);
        });
        window.addEventListener('beforeunload', function () {
            app.stopAllPlayback(false);
            if (app.autosave) app.autosave.saveNow();
            if (app.photoAnalyzerWorker) app.photoAnalyzerWorker.terminate();
            if (app.videoPlayer) app.videoPlayer.destroy();
            if (app.assetManager) app.assetManager.destroy();
            if (app.detachCrashCapture) app.detachCrashCapture();
            app.releaseMusicAudio();
        });
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'hidden') {
                app.stopAllPlayback(true);
                if (app.autosave) app.autosave.saveNow();
            }
        });
    };

    app.checkForUpdates = function (silent) {
        return checkAndInstallUpdate({
            confirm: function (update) {
                return window.confirm('发现新版本 ' + update.version + '，是否立即下载并安装？\n\n' +
                    String(update.body || '').slice(0, 1000));
            },
            onProgress: function (progress) {
                var percent = progress.total ? Math.round(progress.downloaded / progress.total * 100) : 0;
                app.showLoading(true, percent ? '正在下载更新 ' + percent + '%…' : '正在下载更新…');
            },
            beforeRestart: function () {
                app.showLoading(true, '更新已安装，正在重启…');
                return app.autosave ? app.autosave.saveNow() : Promise.resolve();
            },
            onError: function (error) {
                console.warn('检查更新失败:', error);
                app.showLoading(false);
                if (!silent) app.toast('暂时无法检查更新');
            }
        }).then(function (result) {
            if (result && !result.available && !result.error && !silent) app.toast('当前已是最新版本');
            return result;
        });
    };

    /* ------------------------------------------------------------------ *
     *  Mobile sidebar (bottom-sheet drawer)
     * ------------------------------------------------------------------ */

    app.setupMobileSidebar = function () {
        var toggleBtn = document.getElementById('sidebar-toggle');
        var backdrop = document.getElementById('sidebar-backdrop');
        if (!toggleBtn || !backdrop) return;

        /* Keep the JS breakpoint in sync with the CSS mobile layout query. */
        function isMobileLayout() {
            return window.matchMedia('(max-width: 768px)').matches;
        }

        function syncToggleVisibility() {
            toggleBtn.hidden = !isMobileLayout();
            if (!isMobileLayout()) {
                closeSidebar();
                document.querySelectorAll('.sidebar .mobile-category-hidden').forEach(function (panel) {
                    panel.classList.remove('mobile-category-hidden');
                });
            } else {
                var activeCategory = document.querySelector('.workflow-nav [data-workflow-target].active');
                if (activeCategory) showMobileCategory(activeCategory.getAttribute('data-workflow-target'));
            }
        }

        var mobileCategoryPanels = {
            'material-import': ['material-import', 'photo-library-panel'],
            'design-presets': ['design-presets'],
            'design-shape': ['design-shape'],
            'design-layout': ['design-layout', 'design-photo-style', 'design-smart'],
            'design-decorate': ['design-decorate', 'design-music']
        };

        function showMobileCategory(category) {
            if (!isMobileLayout()) return;
            var visibleIds = new Set(mobileCategoryPanels[category] || [category]);
            document.querySelectorAll('.sidebar > section.panel').forEach(function (panel) {
                panel.classList.toggle('mobile-category-hidden', !visibleIds.has(panel.id));
            });
            var sidebar = document.querySelector('.sidebar');
            if (sidebar) sidebar.scrollTo({ top: 0, behavior: 'smooth' });
        }

        function openSidebar() {
            backdrop.hidden = false;
            document.querySelector('.app').classList.add('sidebar-open');
            toggleBtn.setAttribute('aria-expanded', 'true');
            if (!app.photos.length) {
                requestAnimationFrame(function () {
                    var sidebar = document.querySelector('.sidebar');
                    if (sidebar) sidebar.scrollTo({ top: 0, behavior: 'smooth' });
                });
            }
        }

        function closeSidebar() {
            document.querySelector('.app').classList.remove('sidebar-open');
            backdrop.hidden = true;
            toggleBtn.setAttribute('aria-expanded', 'false');
        }

        app.closeMobileSidebar = closeSidebar;

        toggleBtn.addEventListener('click', function () {
            if (document.querySelector('.app').classList.contains('sidebar-open')) {
                closeSidebar();
            } else {
                openSidebar();
            }
        });

        backdrop.addEventListener('click', closeSidebar);
        var closeButton = document.getElementById('mobile-sidebar-close');
        if (closeButton) closeButton.addEventListener('click', closeSidebar);

        document.querySelectorAll('.workflow-nav [data-workflow-target]').forEach(function (button) {
            button.addEventListener('click', function () {
                var target = document.getElementById(button.getAttribute('data-workflow-target'));
                if (!target) return;
                document.querySelectorAll('.workflow-nav [data-workflow-target]').forEach(function (item) {
                    item.classList.toggle('active', item === button);
                });
                if (isMobileLayout()) showMobileCategory(button.getAttribute('data-workflow-target'));
                else target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        });

        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && document.querySelector('.app').classList.contains('sidebar-open')) {
                closeSidebar();
                toggleBtn.focus();
            }
        });

        syncToggleVisibility();
        window.addEventListener('resize', syncToggleVisibility);
    };

    /* ------------------------------------------------------------------ *
     *  UI Binding
     * ------------------------------------------------------------------ */

    app.bindUI = function () {
        document.querySelector('.sidebar').addEventListener('pointerdown', function (event) {
            if (app.flowPlaying && event.target.closest('button, input, select, textarea')) app.stopAllPlayback(true);
        });

        // ---- Mobile sidebar toggle ----
        app.setupMobileSidebar();

        // ---- Product presets ----
        document.getElementById('preset-buttons').addEventListener('click', function (e) {
            var deleteButton = e.target.closest('.preset-delete');
            if (deleteButton) {
                e.stopPropagation();
                app.deleteCustomTemplate(deleteButton.getAttribute('data-template-delete'));
                return;
            }
            var button = e.target.closest('.preset-btn');
            if (button) app.applyLayoutPreset(button.getAttribute('data-preset'));
        });
        document.getElementById('template-search').addEventListener('input', app.renderLayoutPresets);
        document.getElementById('template-category').addEventListener('change', app.renderLayoutPresets);
        document.getElementById('save-template-btn').addEventListener('click', app.saveCurrentTemplate);

        // ---- Text, stickers, borders and layers ----
        document.getElementById('add-title-btn').addEventListener('click', function () {
            app.addOverlay('text', '双击修改标题', { role: 'title', fontSize: 0.062, y: 0.16 });
        });
        document.getElementById('add-date-btn').addEventListener('click', function () {
            app.addOverlay('text', new Date().toLocaleDateString('zh-CN'), {
                role: 'date', fontSize: 0.035, y: 0.84, fontWeight: 'normal'
            });
        });
        document.getElementById('sticker-buttons').addEventListener('click', function (event) {
            var button = event.target.closest('[data-sticker]');
            if (button) app.addOverlay('sticker', button.getAttribute('data-sticker'), {
                role: 'sticker', x: 0.78, y: 0.22, fontSize: 0.085
            });
        });
        document.getElementById('border-style').addEventListener('change', app.updateBorderOverlay);
        document.getElementById('border-color').addEventListener('change', app.updateBorderOverlay);
        document.getElementById('border-remove-btn').addEventListener('click', app.removeBorderOverlay);
        document.getElementById('overlay-delete-btn').addEventListener('click', function () {
            if (app.selectedOverlayId) app.deleteOverlay(app.selectedOverlayId);
        });
        document.getElementById('layer-list').addEventListener('click', app.handleLayerAction);
        var inspector = document.getElementById('overlay-inspector');
        inspector.addEventListener('focusin', function () {
            if (!app.overlayEditSnapshot) app.overlayEditSnapshot = app.captureState();
        });
        inspector.addEventListener('input', app.updateSelectedOverlay);
        inspector.addEventListener('change', function () {
            if (app.overlayEditSnapshot) app.recordHistory(app.overlayEditSnapshot);
            app.overlayEditSnapshot = null;
        });

        // ---- Background music ----
        document.getElementById('music-library').addEventListener('click', function (event) {
            var button = event.target.closest('[data-music-track]');
            if (button) app.useBuiltInMusic(button.getAttribute('data-music-track'));
        });
        document.getElementById('music-upload-btn').addEventListener('click', function () {
            document.getElementById('music-file-input').click();
        });
        document.getElementById('music-file-input').addEventListener('change', function (event) {
            var file = event.target.files[0];
            event.target.value = '';
            if (file) app.loadBackgroundMusic(file);
        });
        document.getElementById('music-remove-btn').addEventListener('click', app.removeBackgroundMusic);
        document.getElementById('music-preview-btn').addEventListener('click', app.toggleMusicPreview);
        var musicSettingIds = ['music-volume', 'music-start', 'music-end', 'music-fade-in', 'music-fade-out', 'music-loop'];
        musicSettingIds.forEach(function (id) {
            document.getElementById(id).addEventListener('input', app.updateBackgroundMusicSettings);
            document.getElementById(id).addEventListener('change', app.updateBackgroundMusicSettings);
        });
        var musicEditor = document.getElementById('music-editor');
        musicEditor.addEventListener('focusin', function (event) {
            if (musicSettingIds.indexOf(event.target.id) >= 0 && !app.musicEditSnapshot) {
                app.musicEditSnapshot = app.captureState();
            }
        });
        musicEditor.addEventListener('change', function () {
            if (app.musicEditSnapshot) app.recordHistory(app.musicEditSnapshot);
            app.musicEditSnapshot = null;
        });

        // ---- Shape buttons ----
        var shapeContainer = document.getElementById('shape-buttons');
        shapeContainer.addEventListener('click', function (e) {
            var btn = e.target.closest('.shape-btn');
            if (!btn) return;
            var key = btn.getAttribute('data-shape');
            app.selectShape(key);
        });

        // ---- Text shape generation ----
        var textInput = document.getElementById('text-shape-input');
        var textBtn = document.getElementById('text-shape-btn');
        function generateTextShape() {
            var text = textInput.value.trim();
            if (!text) { app.toast('请输入文字'); return; }
            app.showLoading(true, '正在生成文字形状…');
            ShapeFactory.fromText(text).then(function (shape) {
                var key = 'text_' + Date.now();
                Shapes.register(key, shape);
                app.addShapeButton(key, shape);
                app.selectShape(key);
                app.showLoading(false);
                app.toast('文字形状已生成');
            }).catch(function (err) {
                app.showLoading(false);
                app.toast('生成失败: ' + err.message);
            });
        }
        textBtn.addEventListener('click', generateTextShape);
        textInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') generateTextShape();
        });

        // ---- Custom image shape ----
        var customShapeBtn = document.getElementById('custom-shape-btn');
        var shapeFileInput = document.getElementById('shape-file-input');
        customShapeBtn.addEventListener('click', function () {
            shapeFileInput.click();
        });
        shapeFileInput.addEventListener('change', function (e) {
            var file = e.target.files[0];
            if (!file) return;
            app.showLoading(true, '正在分析图片…');
            var reader = new FileReader();
            reader.onload = function (ev) {
                var img = new Image();
                img.onload = function () {
                    app.showLoading(false);
                    app.openShapeEditor(img);
                };
                img.onerror = function () {
                    app.showLoading(false);
                    app.toast('图片加载失败');
                };
                img.src = ev.target.result;
            };
            reader.readAsDataURL(file);
            e.target.value = '';
        });

        // ---- Shape extraction editor ----
        ['shape-threshold', 'shape-smooth', 'shape-denoise', 'shape-largest', 'shape-invert'].forEach(function (id) {
            document.getElementById(id).addEventListener('input', app.scheduleShapePreview);
            document.getElementById(id).addEventListener('change', app.scheduleShapePreview);
        });
        document.getElementById('shape-extract-mode').addEventListener('change', function (e) {
            var threshold = document.getElementById('shape-threshold');
            var defaults = { portrait: 46, 'portrait-detail': 132, auto: 42, threshold: 128 };
            threshold.value = defaults[e.target.value] || 46;
            if (e.target.value === 'portrait-detail') {
                document.getElementById('shape-largest').checked = false;
                document.getElementById('shape-smooth').value = '0';
            } else {
                document.getElementById('shape-largest').checked = true;
                document.getElementById('shape-smooth').value = '1';
            }
            app.updateShapeModeUI(e.target.value);
            app.scheduleShapePreview();
        });
        document.getElementById('shape-editor-confirm').addEventListener('click', app.confirmShapeEditor);
        document.getElementById('shape-editor-cancel').addEventListener('click', app.closeShapeEditor);
        document.getElementById('shape-editor-close').addEventListener('click', app.closeShapeEditor);
        document.getElementById('shape-editor').addEventListener('click', function (e) {
            if (e.target === this) app.closeShapeEditor();
        });
        app.bindMaskBrush();

        // ---- Photo upload ----
        var fileInput = document.getElementById('file-input');
        fileInput.addEventListener('change', function (e) {
            app.handleFiles(e.target.files);
            e.target.value = '';
        });

        ['add-photos-btn', 'empty-upload-btn'].forEach(function (id) {
            document.getElementById(id).addEventListener('click', function () { fileInput.click(); });
        });

        var dropZone = document.getElementById('drop-zone');
        dropZone.addEventListener('click', function () { fileInput.click(); });
        dropZone.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fileInput.click();
            }
        });
        dropZone.addEventListener('dragover', function (e) {
            e.preventDefault();
            dropZone.classList.add('drag-over');
        });
        dropZone.addEventListener('dragleave', function () {
            dropZone.classList.remove('drag-over');
        });
        dropZone.addEventListener('drop', function (e) {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            app.handleFiles(e.dataTransfer.files);
        });

        var mainArea = document.querySelector('.main-area');
        mainArea.addEventListener('dragover', function (e) { e.preventDefault(); });
        mainArea.addEventListener('drop', function (e) {
            e.preventDefault();
            app.handleFiles(e.dataTransfer.files);
        });

        // ---- Density slider ----
        var densitySlider = document.getElementById('density-slider');
        var densityValue = document.getElementById('density-value');
        var densitySnapshot = null;
        densitySlider.addEventListener('pointerdown', function () { densitySnapshot = app.captureState(); });
        densitySlider.addEventListener('keydown', function (e) {
            if (/^(Arrow|Home|End|Page)/.test(e.key) && !densitySnapshot) densitySnapshot = app.captureState();
        });
        densitySlider.addEventListener('input', function (e) {
            var val = parseFloat(e.target.value);
            densityValue.textContent = Math.round(val * 100) + '%';
            clearTimeout(app.densityTimer);
            app.densityTimer = setTimeout(function () {
                app.wall.setDensity(val);
            }, 120);
        });
        densitySlider.addEventListener('change', function (e) {
            clearTimeout(app.densityTimer);
            app.wall.setDensity(parseFloat(e.target.value));
            if (densitySnapshot && densitySnapshot.density !== app.wall.density) app.recordHistory(densitySnapshot);
            densitySnapshot = null;
        });

        // ---- Overlap slider ----
        var overlapSlider = document.getElementById('overlap-slider');
        var overlapValue = document.getElementById('overlap-value');
        var overlapSnapshot = null;
        overlapSlider.addEventListener('pointerdown', function () { overlapSnapshot = app.captureState(); });
        overlapSlider.addEventListener('keydown', function (e) {
            if (/^(Arrow|Home|End|Page)/.test(e.key) && !overlapSnapshot) overlapSnapshot = app.captureState();
        });
        overlapSlider.addEventListener('input', function (e) {
            var val = parseFloat(e.target.value);
            overlapValue.textContent = Math.round(val * 100) + '%';
            clearTimeout(app.overlapTimer);
            app.overlapTimer = setTimeout(function () {
                app.wall.setOverlap(val);
            }, 120);
        });
        overlapSlider.addEventListener('change', function (e) {
            clearTimeout(app.overlapTimer);
            app.wall.setOverlap(parseFloat(e.target.value));
            if (overlapSnapshot && overlapSnapshot.gap !== app.wall.gap) app.recordHistory(overlapSnapshot);
            overlapSnapshot = null;
        });

        // ---- Rotation slider ----
        var rotationSlider = document.getElementById('rotation-slider');
        var rotationValue = document.getElementById('rotation-value');
        var rotationSnapshot = null;
        rotationSlider.addEventListener('pointerdown', function () { rotationSnapshot = app.captureState(); });
        rotationSlider.addEventListener('keydown', function (e) {
            if (/^(Arrow|Home|End|Page)/.test(e.key) && !rotationSnapshot) rotationSnapshot = app.captureState();
        });
        rotationSlider.addEventListener('input', function (e) {
            var val = parseInt(e.target.value, 10);
            rotationValue.textContent = val + '°';
            clearTimeout(app.rotationTimer);
            app.rotationTimer = setTimeout(function () { app.wall.setRotationRange(val); }, 120);
        });
        rotationSlider.addEventListener('change', function (e) {
            clearTimeout(app.rotationTimer);
            app.wall.setRotationRange(parseInt(e.target.value, 10));
            if (rotationSnapshot && rotationSnapshot.rotationRange !== app.wall.rotationRange) app.recordHistory(rotationSnapshot);
            rotationSnapshot = null;
        });

        // ---- Smart placement toggle ----
        document.getElementById('smart-toggle').addEventListener('change', function (e) {
            app.recordHistory();
            app.wall.setSmartPlacement(e.target.checked);
        });

        // ---- Mixed large/small cells ----
        document.getElementById('mixed-size-toggle').addEventListener('change', function (e) {
            app.recordHistory();
            app.wall.setMixedSizes(e.target.checked);
            app.toast(e.target.checked ? '已开启大小图混排' : '已恢复统一大小');
        });

        // ---- Placement mode buttons ----
        var modeContainer = document.getElementById('mode-buttons');
        modeContainer.addEventListener('click', function (e) {
            var btn = e.target.closest('.mode-btn');
            if (!btn) return;
            var mode = btn.getAttribute('data-mode');
            if (mode === app.wall.placementMode) return;
            app.recordHistory();
            document.querySelectorAll('.mode-btn').forEach(function (b) {
                b.classList.remove('active');
            });
            btn.classList.add('active');
            app.wall.setPlacementMode(mode);
            document.getElementById('matrix-columns').value = app.wall.matrixColumns;
            app.updateModeHint();
        });

        document.getElementById('matrix-columns').addEventListener('change', function () {
            var columns = Number(this.value) || 0;
            if (columns === app.wall.matrixColumns) return;
            app.recordHistory();
            app.wall.setMatrixColumns(columns);
            app.syncLayoutControls();
            app.toast(columns ? '已应用 ' + columns + ' × ' + columns + ' 矩阵' : '已恢复自动布局');
        });

        // ---- Photo shape buttons ----
        var psContainer = document.getElementById('photo-shape-buttons');
        psContainer.addEventListener('click', function (e) {
            var btn = e.target.closest('.ps-btn');
            if (!btn) return;
            var photoShape = btn.getAttribute('data-pshape');
            if (photoShape === app.wall.photoShape) return;
            app.recordHistory();
            document.querySelectorAll('.ps-btn').forEach(function (b) {
                b.classList.remove('active');
            });
            btn.classList.add('active');
            app.wall.setPhotoShape(photoShape);
            app.updateLayoutPresetSelection();
        });

        // ---- Actions ----
        document.getElementById('shuffle-btn').addEventListener('click', function () {
            if (!app.photos.length) return;
            app.stopAllPlayback(true);
            app.recordHistory();
            var seed = app.wall.nextLayoutVariant();
            app.toast('已生成新方案 · #' + seed);
        });
        document.getElementById('position-mode-btn').addEventListener('click', function () {
            app.setPositionMode(app.wall.interactionMode !== 'adjust');
        });
        var localZoomRange = document.getElementById('local-zoom-range');
        localZoomRange.addEventListener('input', function () {
            app.setSelectedLocalZoom(Number(this.value));
        });
        localZoomRange.addEventListener('change', function () {
            app.commitLocalAdjust('已缩放当前格位中的照片');
        });
        document.getElementById('local-zoom-out').addEventListener('click', function () {
            if (app.stepSelectedLocalZoom(-0.1)) app.commitLocalAdjust('已缩小当前格位中的照片');
        });
        document.getElementById('local-zoom-in').addEventListener('click', function () {
            if (app.stepSelectedLocalZoom(0.1)) app.commitLocalAdjust('已放大当前格位中的照片');
        });
        document.getElementById('local-adjust-reset').addEventListener('click', function () {
            var index = app.wall.localAdjustIndex;
            var item = app.wall.layout[index];
            if (!item) return;
            app.beginLocalAdjust();
            if (app.wall.resetLocalAdjust(index)) {
                app.updateLocalAdjustControls();
                app.commitLocalAdjust('已复位当前格位中的照片');
            } else {
                app.localAdjustSnapshot = null;
            }
        });
        document.getElementById('local-adjust-close').addEventListener('click', function () {
            app.wall.selectLocalAdjust(-1);
            document.getElementById('wall-canvas').focus();
        });
        document.getElementById('wall-canvas').addEventListener('wheel', function (event) {
            if (app.wall.interactionMode !== 'adjust') return;
            var rect = this.getBoundingClientRect();
            var hovered = app.wall.getPhotoAt(event.clientX - rect.left, event.clientY - rect.top);
            if (hovered >= 0) app.wall.selectLocalAdjust(hovered);
            if (app.wall.localAdjustIndex < 0) return;
            event.preventDefault();
            var factor = Math.exp(-event.deltaY * 0.002);
            var item = app.wall.layout[app.wall.localAdjustIndex];
            if (!item || !app.setSelectedLocalZoom((Number(item.localZoom) || 1) * factor)) return;
            clearTimeout(app.localAdjustCommitTimer);
            app.localAdjustCommitTimer = setTimeout(function () {
                app.commitLocalAdjust('已缩放当前格位中的照片');
            }, 180);
        }, { passive: false });
        document.getElementById('flow-play-btn').addEventListener('click', function () {
            if (app.flowPlaying || app.revealTimeline) app.stopAllPlayback(true);
            else app.startPlayback();
        });
        document.getElementById('flow-speed').addEventListener('change', function () {
            if (app.flowPlaying) app.restartPlayback();
        });
        document.getElementById('playback-mode').addEventListener('change', function () {
            app.playbackMode = this.value;
            app.updateFlowControls();
            app.updateActionState();
            if (app.autosave) app.autosave.schedule();
            if (app.flowPlaying || app.revealTimeline) {
                app.stopAllPlayback(true);
                app.startPlayback();
            }
        });
        document.getElementById('playback-order').addEventListener('change', function () {
            app.playbackOrder = this.value;
            if (app.playbackOrder === 'custom') {
                app.customOrigin = null;
                document.getElementById('wall-canvas').classList.add('selecting-playback-origin');
                app.toast('请在照片墙上点击播放起点');
            } else {
                document.getElementById('wall-canvas').classList.remove('selecting-playback-origin');
                document.getElementById('playback-origin-marker').classList.remove('visible');
            }
            app.updateActionState();
            if (app.autosave) app.autosave.schedule();
            if (app.flowPlaying || app.revealTimeline) {
                app.stopAllPlayback(true);
                app.startPlayback();
            }
        });
        document.getElementById('playback-transition').addEventListener('change', function () {
            app.playbackTransition = this.value;
            if (app.autosave) app.autosave.schedule();
            if (app.flowPlaying || app.revealTimeline) app.restartPlayback();
        });
        document.getElementById('wall-canvas').addEventListener('pointerdown', function (event) {
            if (app.playbackOrder !== 'custom' || app.flowPlaying) return;
            var rect = this.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            app.customOrigin = {
                normalizedX: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
                normalizedY: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
            };
            this.classList.remove('selecting-playback-origin');
            app.updateCustomOriginMarker();
            if (app.autosave) app.autosave.schedule();
            app.toast('播放起点已设置，点击播放即可预览');
            event.preventDefault();
            event.stopImmediatePropagation();
        }, true);
        document.getElementById('clear-btn').addEventListener('click', function () {
            app.clearPhotos();
        });
        document.getElementById('export-btn').addEventListener('click', function () {
            app.openExportDialog();
        });
        document.getElementById('undo-btn').addEventListener('click', app.undo);
        document.getElementById('redo-btn').addEventListener('click', app.redo);
        document.getElementById('save-project-btn').addEventListener('click', app.saveProject);
        document.getElementById('open-project-btn').addEventListener('click', function () {
            document.getElementById('project-file-input').click();
        });
        document.getElementById('restore-backup-btn').addEventListener('click', app.restoreLatestBackup);
        document.getElementById('project-file-input').addEventListener('change', function (e) {
            var file = e.target.files[0];
            if (file) app.openProject(file);
            e.target.value = '';
        });

        // ---- Export dialog ----
        document.getElementById('export-close').addEventListener('click', app.closeExportDialog);
        document.getElementById('export-cancel').addEventListener('click', app.closeExportDialog);
        document.getElementById('export-dialog').addEventListener('click', function (e) {
            if (e.target === this) app.closeExportDialog();
        });
        document.querySelectorAll('input[name="export-format"], input[name="export-scale"], input[name="export-aspect"]').forEach(function (input) {
            input.addEventListener('change', app.updateExportOptions);
        });
        document.querySelectorAll('input[name="export-category"]').forEach(function (input) {
            input.addEventListener('change', app.onExportCategoryChange);
        });
        ['export-print-size', 'export-print-dpi', 'export-print-bleed'].forEach(function (id) {
            document.getElementById(id).addEventListener('change', app.updateExportOptions);
        });
        document.getElementById('export-video-preset').addEventListener('change', app.updateExportOptions);
        document.querySelectorAll('input[name="export-background"]').forEach(function (input) {
            input.addEventListener('change', app.scheduleExportPreview);
        });
        document.getElementById('export-background-color').addEventListener('input', function () {
            document.querySelector('input[name="export-background"][value="custom"]').checked = true;
            app.scheduleExportPreview();
        });
        document.getElementById('export-confirm').addEventListener('click', app.exportImage);

        // ---- Lightbox ----
        document.getElementById('lightbox-close').addEventListener('click', function () {
            app.closeLightbox();
        });
        document.getElementById('lightbox').addEventListener('click', function (e) {
            if (e.target === this) app.closeLightbox();
        });
        document.getElementById('lightbox-prev').addEventListener('click', function (e) {
            e.stopPropagation();
            app.navigateLightbox(-1);
        });
        document.getElementById('lightbox-next').addEventListener('click', function (e) {
            e.stopPropagation();
            app.navigateLightbox(1);
        });
        document.getElementById('lightbox-system-player').addEventListener('click', function (e) {
            e.stopPropagation();
            var photo = app.photos[app.lightboxIndex];
            var source = photo && (photo.originalBlob || photo.workingBlob || photo.blob);
            if (!photo || photo.mediaType !== 'video' || !(source instanceof Blob)) return;
            var button = e.currentTarget;
            button.disabled = true;
            button.textContent = isNativeApp() ? '正在打开系统播放器…' : '正在下载原视频…';
            openBlobWithSystem(source, photo.name || 'video.mp4').then(function (result) {
                if (result && result.cancelled) return;
                app.toast(result && result.opened ? '已交给系统播放器' : '原视频已保存，请使用系统播放器打开');
            }).catch(function (error) {
                console.error(error);
                app.toast('无法打开原视频');
            }).finally(function () {
                button.disabled = false;
                button.textContent = isNativeApp() ? '使用系统播放器' : '下载原视频';
            });
        });
        document.getElementById('lightbox-browser-play').addEventListener('click', function (e) {
            e.stopPropagation();
            app.playLightboxVideoInBrowser();
        });
        document.getElementById('lightbox-edit').addEventListener('click', function (e) {
            e.stopPropagation();
            var photoIndex = app.lightboxIndex;
            if (!app.photos[photoIndex]) return;
            app.closeLightbox();
            app.openPhotoEditor(photoIndex);
        });

        // ---- Single photo editor ----
        ['photo-editor-close', 'photo-editor-cancel'].forEach(function (id) {
            document.getElementById(id).addEventListener('click', function () { app.closePhotoEditor(); });
        });
        document.getElementById('photo-editor').addEventListener('click', function (e) {
            if (e.target === this) app.closePhotoEditor();
        });
        ['photo-edit-zoom', 'photo-edit-focus-x', 'photo-edit-focus-y', 'photo-edit-rotation'].forEach(function (id) {
            document.getElementById(id).addEventListener('input', app.updatePhotoEditorDraft);
        });
        document.getElementById('photo-edit-flip-x').addEventListener('click', function () {
            if (!app.photoEditorDraft) return;
            app.photoEditorDraft.flipX = !app.photoEditorDraft.flipX;
            app.syncPhotoEditorControls();
            app.renderPhotoEditorPreview();
        });
        document.getElementById('photo-edit-flip-y').addEventListener('click', function () {
            if (!app.photoEditorDraft) return;
            app.photoEditorDraft.flipY = !app.photoEditorDraft.flipY;
            app.syncPhotoEditorControls();
            app.renderPhotoEditorPreview();
        });
        document.getElementById('photo-edit-reset').addEventListener('click', function () {
            app.photoEditorDraft = normalizePhotoTransform({ focusX: 0.5, focusY: 0.5 });
            app.syncPhotoEditorControls();
            app.renderPhotoEditorPreview();
        });
        document.getElementById('photo-edit-replace').addEventListener('click', function () {
            document.getElementById('photo-edit-file').click();
        });
        document.getElementById('photo-edit-file').addEventListener('change', function (e) {
            var file = e.target.files[0];
            e.target.value = '';
            if (file) app.replacePhotoEditorSource(file);
        });
        document.getElementById('photo-editor-confirm').addEventListener('click', app.confirmPhotoEditor);

        document.addEventListener('keydown', function (e) {
            var targetTag = e.target && e.target.tagName;
            var isTyping = targetTag === 'INPUT' || targetTag === 'TEXTAREA' || targetTag === 'SELECT';
            /* Modals and the lightbox snapshot app state on open; letting a
               global Ctrl+Z through would undo underneath them and desync
               photo indices (e.g. the single-photo editor confirming onto
               the wrong photo). */
            var modalOpen = document.querySelector('.app').inert === true;
            if (modalOpen && (e.ctrlKey || e.metaKey) &&
                (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) return;
            if ((e.ctrlKey || e.metaKey) && !isTyping && e.key.toLowerCase() === 's') {
                e.preventDefault();
                app.saveProject();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && !isTyping && e.key.toLowerCase() === 'o') {
                e.preventDefault();
                document.getElementById('project-file-input').click();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && !isTyping && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                if (e.shiftKey) app.redo(); else app.undo();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && !isTyping && e.key.toLowerCase() === 'y') {
                e.preventDefault();
                app.redo();
                return;
            }
            if ((e.key === 'Delete' || e.key === 'Backspace') && !isTyping && app.selectedOverlayId) {
                e.preventDefault();
                app.deleteOverlay(app.selectedOverlayId);
                return;
            }
            if (e.key === 'Escape' && document.getElementById('shape-editor').classList.contains('active')) {
                app.closeShapeEditor();
                return;
            }
            if (e.key === 'Escape' && document.getElementById('photo-editor').classList.contains('active')) {
                app.closePhotoEditor();
                return;
            }
            if (e.key === 'Tab' && document.getElementById('photo-editor').classList.contains('active')) {
                app.trapDialogFocus(e, document.querySelector('#photo-editor .photo-editor-card'));
                return;
            }
            if (e.key === 'Tab' && document.getElementById('shape-editor').classList.contains('active')) {
                app.trapDialogFocus(e, document.querySelector('#shape-editor .shape-editor-card'));
                return;
            }
            if (e.key === 'Escape' && document.getElementById('export-dialog').classList.contains('active')) {
                app.closeExportDialog();
                return;
            }
            if (e.key === 'Tab' && document.getElementById('export-dialog').classList.contains('active')) {
                app.trapDialogFocus(e, document.querySelector('#export-dialog .export-card'));
                return;
            }
            var lb = document.getElementById('lightbox');
            if (!lb.classList.contains('active')) return;
            if (e.key === 'Tab') app.trapDialogFocus(e, lb);
            else if (e.key === 'Escape') app.closeLightbox();
            else if (e.key === 'ArrowLeft') app.navigateLightbox(-1);
            else if (e.key === 'ArrowRight') app.navigateLightbox(1);
        });
    };

    /* ------------------------------------------------------------------ *
     *  Shape extraction editor
     * ------------------------------------------------------------------ */

    app.bindMaskBrush = function () {
        var preview = document.getElementById('shape-mask-preview');
        var sizeInput = document.getElementById('mask-brush-size');

        document.getElementById('brush-mode-buttons').addEventListener('click', function (e) {
            var button = e.target.closest('.brush-mode-btn');
            if (button) app.setMaskBrushMode(button.getAttribute('data-brush-mode'));
        });
        sizeInput.addEventListener('input', function () {
            document.getElementById('mask-brush-size-value').textContent = sizeInput.value;
        });
        document.getElementById('mask-undo-stroke').addEventListener('click', function () {
            if (!app.maskStrokes.length) return;
            app.maskStrokes.pop();
            app.updateMaskBrushActions();
            app.scheduleShapePreview();
        });
        document.getElementById('mask-reset-strokes').addEventListener('click', function () {
            if (!app.maskStrokes.length) return;
            app.maskStrokes = [];
            app.updateMaskBrushActions();
            app.scheduleShapePreview();
        });

        preview.addEventListener('pointerdown', function (e) {
            if (!app.pendingShapeImage || !app.maskPreviewMeta) return;
            var point = app.getMaskBrushPoint(e);
            if (!point) return;
            e.preventDefault();
            var rect = preview.getBoundingClientRect();
            var internalScale = preview.width / Math.max(1, rect.width);
            var brushPixels = parseInt(sizeInput.value, 10) * internalScale;
            var stroke = {
                mode: app.maskBrushMode,
                size: brushPixels / Math.max(1, Math.min(app.maskPreviewMeta.width, app.maskPreviewMeta.height)),
                points: [point]
            };
            app.maskStrokes.push(stroke);
            app.maskBrushPointerId = e.pointerId;
            try { preview.setPointerCapture(e.pointerId); } catch (ignore) {}
            app.updateMaskBrushActions();
            app.scheduleShapePreview();
        });
        preview.addEventListener('pointermove', function (e) {
            if (app.maskBrushPointerId !== e.pointerId || !app.maskStrokes.length) return;
            var point = app.getMaskBrushPoint(e);
            if (!point) return;
            e.preventDefault();
            var stroke = app.maskStrokes[app.maskStrokes.length - 1];
            var last = stroke.points[stroke.points.length - 1];
            if (Math.hypot(point.x - last.x, point.y - last.y) < Math.max(0.002, stroke.size * 0.08)) return;
            stroke.points.push(point);
            app.scheduleShapePreview();
        });
        function finishStroke(e) {
            if (app.maskBrushPointerId !== e.pointerId) return;
            app.maskBrushPointerId = null;
            try { preview.releasePointerCapture(e.pointerId); } catch (ignore) {}
            app.scheduleShapePreview();
        }
        preview.addEventListener('pointerup', finishStroke);
        preview.addEventListener('pointercancel', finishStroke);
    };

    app.bindShapeCrop = function () {
        var preview = document.getElementById('shape-source-preview');
        document.getElementById('shape-crop-reset').addEventListener('click', function () {
            app.shapeCrop = { x: 0, y: 0, width: 1, height: 1 };
            app.maskStrokes = [];
            app.updateMaskBrushActions();
            app.scheduleShapePreview();
        });
        preview.addEventListener('pointerdown', function (e) {
            if (!app.pendingShapeImage || !app.sourcePreviewMeta) return;
            var point = app.getShapeCropPoint(e);
            if (!point) return;
            e.preventDefault();
            app.shapeCropStart = { x: point.x, y: point.y, previous: app.shapeCrop };
            app.shapeCropPointerId = e.pointerId;
            try { preview.setPointerCapture(e.pointerId); } catch (ignore) {}
        });
        preview.addEventListener('pointermove', function (e) {
            if (app.shapeCropPointerId !== e.pointerId || !app.shapeCropStart) return;
            var point = app.getShapeCropPoint(e);
            if (!point) return;
            e.preventDefault();
            var x = Math.min(app.shapeCropStart.x, point.x);
            var y = Math.min(app.shapeCropStart.y, point.y);
            app.shapeCrop = {
                x: x,
                y: y,
                width: Math.max(0.01, Math.max(app.shapeCropStart.x, point.x) - x),
                height: Math.max(0.01, Math.max(app.shapeCropStart.y, point.y) - y)
            };
            app.maskStrokes = [];
            app.updateMaskBrushActions();
            app.scheduleShapePreview();
        });
        function finishCrop(e) {
            if (app.shapeCropPointerId !== e.pointerId || !app.shapeCropStart) return;
            if (app.shapeCrop.width < 0.035 || app.shapeCrop.height < 0.035) {
                app.shapeCrop = app.shapeCropStart.previous;
            }
            app.shapeCropPointerId = null;
            app.shapeCropStart = null;
            try { preview.releasePointerCapture(e.pointerId); } catch (ignore) {}
            app.scheduleShapePreview();
        }
        preview.addEventListener('pointerup', finishCrop);
        preview.addEventListener('pointercancel', finishCrop);
    };

    app.getShapeCropPoint = function (event) {
        var preview = document.getElementById('shape-source-preview');
        var meta = app.sourcePreviewMeta;
        if (!meta) return null;
        var rect = preview.getBoundingClientRect();
        var px = (event.clientX - rect.left) * preview.width / Math.max(1, rect.width);
        var py = (event.clientY - rect.top) * preview.height / Math.max(1, rect.height);
        if (px < meta.x || px > meta.x + meta.width || py < meta.y || py > meta.y + meta.height) return null;
        return {
            x: Math.max(0, Math.min(1, (px - meta.x) / meta.width)),
            y: Math.max(0, Math.min(1, (py - meta.y) / meta.height))
        };
    };

    app.drawShapeCropOverlay = function () {
        var canvas = document.getElementById('shape-source-preview');
        var meta = app.sourcePreviewMeta;
        if (!meta) return;
        var crop = app.shapeCrop;
        var x = meta.x + crop.x * meta.width;
        var y = meta.y + crop.y * meta.height;
        var width = crop.width * meta.width;
        var height = crop.height * meta.height;
        var ctx = canvas.getContext('2d');
        ctx.save();
        ctx.fillStyle = 'rgba(8,8,14,.56)';
        ctx.beginPath();
        ctx.rect(meta.x, meta.y, meta.width, meta.height);
        ctx.rect(x, y, width, height);
        ctx.fill('evenodd');
        ctx.strokeStyle = '#9d8fff';
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 5]);
        ctx.strokeRect(x, y, width, height);
        ctx.restore();
    };

    app.setMaskBrushMode = function (mode) {
        app.maskBrushMode = mode === 'erase' ? 'erase' : 'keep';
        document.querySelectorAll('.brush-mode-btn').forEach(function (button) {
            button.classList.toggle('active', button.getAttribute('data-brush-mode') === app.maskBrushMode);
        });
    };

    app.getMaskBrushPoint = function (event) {
        var preview = document.getElementById('shape-mask-preview');
        var meta = app.maskPreviewMeta;
        if (!meta) return null;
        var rect = preview.getBoundingClientRect();
        var px = (event.clientX - rect.left) * preview.width / Math.max(1, rect.width);
        var py = (event.clientY - rect.top) * preview.height / Math.max(1, rect.height);
        if (px < meta.x || px > meta.x + meta.width || py < meta.y || py > meta.y + meta.height) return null;
        return {
            x: Math.max(0, Math.min(1, (px - meta.x) / meta.width)),
            y: Math.max(0, Math.min(1, (py - meta.y) / meta.height))
        };
    };

    app.updateMaskBrushActions = function () {
        var disabled = app.maskStrokes.length === 0;
        document.getElementById('mask-undo-stroke').disabled = disabled;
        document.getElementById('mask-reset-strokes').disabled = disabled;
    };

    app.getShapeEditorOptions = function () {
        return {
            mode: document.getElementById('shape-extract-mode').value,
            threshold: parseInt(document.getElementById('shape-threshold').value, 10),
            smooth: parseInt(document.getElementById('shape-smooth').value, 10),
            denoise: parseInt(document.getElementById('shape-denoise').value, 10),
            keepLargest: document.getElementById('shape-largest').checked,
            invert: document.getElementById('shape-invert').checked,
            crop: Object.assign({}, app.shapeCrop),
            strokes: app.maskStrokes
        };
    };

    app.openShapeEditor = function (img) {
        var activeElement = document.activeElement;
        var editor = document.getElementById('shape-editor');
        app.shapeEditorReturnFocus = activeElement && activeElement !== document.body && activeElement.id !== 'shape-file-input' && !editor.contains(activeElement) ?
            activeElement : document.getElementById('custom-shape-btn');
        app.pendingShapeImage = img;
        document.getElementById('shape-extract-mode').value = 'portrait';
        document.getElementById('shape-threshold').value = '46';
        document.getElementById('shape-smooth').value = '1';
        document.getElementById('shape-denoise').value = '2';
        document.getElementById('shape-largest').checked = true;
        document.getElementById('shape-invert').checked = false;
        app.shapeCrop = { x: 0, y: 0, width: 1, height: 1 };
        app.shapeCropStart = null;
        app.shapeCropPointerId = null;
        app.maskStrokes = [];
        app.maskBrushPointerId = null;
        app.maskPreviewMeta = null;
        app.setMaskBrushMode('keep');
        app.updateMaskBrushActions();
        document.getElementById('shape-mask-preview').classList.add('editable');
        app.updateShapeModeUI('portrait');
        document.querySelector('.app').inert = true;
        editor.classList.add('active');
        editor.setAttribute('aria-hidden', 'false');
        setTimeout(function () { document.getElementById('shape-editor-close').focus(); }, 0);
        requestAnimationFrame(app.updateShapePreview);
    };

    app.updateShapeModeUI = function (mode) {
        var tips = {
            portrait: '适合人物照片：从图片边缘识别背景，并保护相近肤色',
            'portrait-detail': '适合肖像拼贴：保留头发、眉眼、鼻唇和阴影等多个深色区域；建议先在左图裁剪到头像',
            auto: '适合 Logo、商品等纯色背景图片',
            threshold: '适合黑白图案：低于阈值的深色区域会成为主体'
        };
        var thresholdLabel = document.getElementById('shape-threshold-label');
        if (thresholdLabel) thresholdLabel.textContent = mode === 'portrait-detail' ? '特征明暗阈值' : '背景去除强度';
        document.getElementById('shape-extract-tip').textContent = tips[mode] || tips.portrait;
    };

    app.closeShapeEditor = function () {
        app.hideShapeEditor();
        app.pendingShapeImage = null;
        app.maskBrushPointerId = null;
        app.maskPreviewMeta = null;
        app.sourcePreviewMeta = null;
        app.shapeCropPointerId = null;
        if (app.shapePreviewRAF) cancelAnimationFrame(app.shapePreviewRAF);
        app.shapePreviewRAF = null;
    };

    app.hideShapeEditor = function () {
        var editor = document.getElementById('shape-editor');
        editor.classList.remove('active');
        editor.setAttribute('aria-hidden', 'true');
        document.querySelector('.app').inert = false;
        if (app.shapeEditorReturnFocus && typeof app.shapeEditorReturnFocus.focus === 'function') app.shapeEditorReturnFocus.focus();
        app.shapeEditorReturnFocus = null;
    };

    app.scheduleShapePreview = function () {
        if (app.shapePreviewRAF) cancelAnimationFrame(app.shapePreviewRAF);
        app.shapePreviewRAF = requestAnimationFrame(function () {
            app.shapePreviewRAF = null;
            app.updateShapePreview();
        });
    };

    app.drawPreviewCanvas = function (target, source) {
        var width = Math.max(240, Math.round(target.clientWidth * (window.devicePixelRatio || 1)));
        var height = Math.max(145, Math.round(target.clientHeight * (window.devicePixelRatio || 1)));
        target.width = width; target.height = height;
        var ctx = target.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
        var scale = Math.min(width / source.width, height / source.height);
        var drawW = source.width * scale, drawH = source.height * scale;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        var drawX = (width - drawW) / 2, drawY = (height - drawH) / 2;
        ctx.drawImage(source, drawX, drawY, drawW, drawH);
        return { x: drawX, y: drawY, width: drawW, height: drawH };
    };

    app.updateShapePreview = function () {
        if (!app.pendingShapeImage) return;
        var options = app.getShapeEditorOptions();
        document.getElementById('shape-threshold-value').textContent = options.threshold;
        document.getElementById('shape-smooth-value').textContent = options.smooth;
        document.getElementById('shape-denoise-value').textContent = options.denoise;
        try {
            var result = ShapeFactory.createImageMask(app.pendingShapeImage, options, 320);
            app.sourcePreviewMeta = app.drawPreviewCanvas(document.getElementById('shape-source-preview'), result.originalCanvas || result.sourceCanvas);
            app.drawShapeCropOverlay();
            app.maskPreviewMeta = app.drawPreviewCanvas(document.getElementById('shape-mask-preview'), result.canvas);
            var coverage = Math.round(result.coverage * 100);
            var qualityHint = coverage > 86 ? ' · 背景残留较多，建议增强去除' :
                coverage < 4 ? ' · 主体过少，建议降低强度' : '';
            if (!qualityHint && result.stats && result.stats.smallComponents > 2) {
                qualityHint = ' · 仍有零散噪点，可增强降噪';
            }
            document.getElementById('shape-mask-caption').textContent = '轮廓蒙版 · 主体约 ' + coverage + '%' + qualityHint;
        } catch (error) {
            app.toast('轮廓预览失败');
            console.error(error);
        }
    };

    app.confirmShapeEditor = function () {
        if (!app.pendingShapeImage) return;
        var img = app.pendingShapeImage;
        var options = app.getShapeEditorOptions();
        app.hideShapeEditor();
        app.showLoading(true, '正在生成轮廓…');
        ShapeFactory.fromImage(img, options).then(function (shape) {
            var key = 'custom_' + Date.now();
            Shapes.register(key, shape);
            app.addShapeButton(key, shape);
            app.selectShape(key);
            app.pendingShapeImage = null;
            app.showLoading(false);
            app.toast('人物/图片轮廓已添加');
        }).catch(function (error) {
            app.showLoading(false);
            app.toast('轮廓生成失败: ' + error.message);
        });
    };

    /* ------------------------------------------------------------------ *
     *  Shape buttons
     * ------------------------------------------------------------------ */

    app.renderShapeButtons = function () {
        var container = document.getElementById('shape-buttons');
        var html = '';
        var keys = Shapes.keys().filter(function (key) { return !Shapes[key].dynamic; });
        keys.forEach(function (key, idx) {
            var shape = Shapes[key];
            html += app.buildShapeButtonHTML(key, shape, idx === 0);
        });
        container.innerHTML = html;
    };

    app.buildShapeButtonHTML = function (key, shape, active) {
        var paths = shape.paths.map(function (d) {
            return '<path d="' + d + '" fill="currentColor"/>';
        }).join('');
        var iconBox = shape.thumbnailViewBox || shape.viewBox;
        return '<button class="shape-btn' + (active ? ' active' : '') + '" data-shape="' + key + '">' +
            '<svg viewBox="0 0 ' + iconBox.width + ' ' + iconBox.height + '" preserveAspectRatio="xMidYMid meet">' +
            paths + '</svg><span>' + shape.name + '</span></button>';
    };

    app.addShapeButton = function (key, shape) {
        var container = document.getElementById('shape-buttons');
        var wrapper = document.createElement('div');
        wrapper.innerHTML = app.buildShapeButtonHTML(key, shape, false);
        var btn = wrapper.firstChild;
        btn.classList.add('dynamic');
        container.appendChild(btn);
    };

    app.selectShape = function (key) {
        if (!Shapes[key] || key === app.currentShapeKey) return;
        app.recordHistory();
        app.currentShapeKey = key;
        document.querySelectorAll('.shape-btn').forEach(function (b) {
            b.classList.toggle('active', b.getAttribute('data-shape') === key);
        });
        app.wall.setShape(key);
    };

    app.updateModeHint = function () {
        var hints = {
            grid: '无缝铺满，适合清晰轮廓',
            brick: '交错排列，边缘更自然',
            organic: '轻微错位，呈现手工拼贴感'
        };
        var active = document.querySelector('.mode-btn.active');
        var mode = active ? active.getAttribute('data-mode') : 'grid';
        document.getElementById('mode-hint').textContent = hints[mode] || hints.grid;
    };

    app.escapeHTML = function (value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
        });
    };

    app.getTemplates = function () {
        return LAYOUT_PRESETS.concat(app.templateLibrary ? app.templateLibrary.list() : []);
    };

    app.findTemplate = function (id) {
        return app.getTemplates().find(function (preset) { return preset.id === id; }) || null;
    };

    app.renderLayoutPresets = function () {
        var container = document.getElementById('preset-buttons');
        var queryElement = document.getElementById('template-search');
        var categoryElement = document.getElementById('template-category');
        var query = queryElement ? queryElement.value.trim().toLowerCase() : '';
        var category = categoryElement ? categoryElement.value : 'all';
        var templates = app.getTemplates().filter(function (preset) {
            var matchesCategory = category === 'all' || preset.category === category;
            var haystack = (preset.name + ' ' + preset.description + ' ' + preset.category).toLowerCase();
            return matchesCategory && (!query || haystack.indexOf(query) >= 0);
        });
        container.innerHTML = templates.map(function (preset) {
            var hasThumb = Boolean(preset.thumbnail);
            var thumb = hasThumb ? '<span class="preset-thumb" aria-hidden="true" style="background-image:url(&quot;' +
                app.escapeHTML(preset.thumbnail) + '&quot;)"></span>' : '';
            return '<div class="preset-card"><button class="preset-btn' + (hasThumb ? ' has-thumb' : '') +
                '" type="button" data-preset="' + preset.id +
                '" aria-pressed="false" title="应用' + app.escapeHTML(preset.name) + '模板">' +
                thumb +
                '<span class="preset-icon" aria-hidden="true">' + app.escapeHTML(preset.icon) + '</span>' +
                '<span class="preset-copy"><strong>' + app.escapeHTML(preset.name) + '</strong><small>' +
                app.escapeHTML(preset.description) + '</small></span></button>' +
                (preset.custom ? '<button class="preset-delete" type="button" data-template-delete="' +
                    preset.id + '" aria-label="删除' + app.escapeHTML(preset.name) + '">×</button>' : '') + '</div>';
        }).join('');
        var empty = document.getElementById('template-empty');
        if (empty) empty.hidden = templates.length > 0;
        app.updateLayoutPresetSelection();
    };

    app.updateLayoutPresetSelection = function () {
        if (!app.wall) return;
        document.querySelectorAll('.preset-btn[data-preset]').forEach(function (button) {
            var preset = app.findTemplate(button.getAttribute('data-preset'));
            var active = layoutPresetMatches(app.wall, app.currentShapeKey, preset);
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
    };

    app.syncLayoutControls = function () {
        document.querySelectorAll('.shape-btn').forEach(function (button) {
            button.classList.toggle('active', button.getAttribute('data-shape') === app.currentShapeKey);
        });
        document.querySelectorAll('.mode-btn').forEach(function (button) {
            button.classList.toggle('active', button.getAttribute('data-mode') === app.wall.placementMode);
        });
        document.querySelectorAll('.ps-btn').forEach(function (button) {
            button.classList.toggle('active', button.getAttribute('data-pshape') === app.wall.photoShape);
        });
        document.getElementById('density-slider').value = app.wall.density;
        document.getElementById('density-value').textContent = Math.round(app.wall.density * 100) + '%';
        document.getElementById('overlap-slider').value = app.wall.gap;
        document.getElementById('overlap-value').textContent = Math.round(app.wall.gap * 100) + '%';
        document.getElementById('rotation-slider').value = app.wall.rotationRange;
        document.getElementById('rotation-value').textContent = app.wall.rotationRange + '°';
        document.getElementById('smart-toggle').checked = app.wall.smartPlacement;
        document.getElementById('mixed-size-toggle').checked = app.wall.mixedSizes;
        document.getElementById('matrix-columns').value = app.wall.matrixColumns;
        document.getElementById('density-slider').disabled = app.wall.matrixColumns > 0;
        document.getElementById('mixed-size-toggle').disabled = app.wall.matrixColumns > 0;
        app.updateModeHint();
        app.updateLayoutPresetSelection();
    };

    app.applyLayoutPreset = function (presetId) {
        var preset = app.findTemplate(presetId);
        if (!preset || layoutPresetMatches(app.wall, app.currentShapeKey, preset)) return;
        app.stopAllPlayback(true);
        app.recordHistory();
        clearTimeout(app.densityTimer);
        clearTimeout(app.overlapTimer);
        clearTimeout(app.rotationTimer);
        app.currentShapeKey = preset.shapeKey || app.currentShapeKey;
        applyLayoutPreset(app.wall, preset, preset.shapeKey ? Shapes[preset.shapeKey] : null);
        app.syncLayoutControls();
        app.toast('已应用“' + preset.name + '”模板');
    };

    app.createTemplateThumbnail = function () {
        if (!app.wall || !app.wall.canvas || !app.wall.canvas.width) return '';
        var canvas = document.createElement('canvas');
        canvas.width = 240;
        canvas.height = 120;
        var context = canvas.getContext('2d');
        context.fillStyle = '#101018';
        context.fillRect(0, 0, canvas.width, canvas.height);
        var scale = Math.min(canvas.width / app.wall.canvas.width, canvas.height / app.wall.canvas.height);
        var width = app.wall.canvas.width * scale;
        var height = app.wall.canvas.height * scale;
        context.drawImage(app.wall.canvas, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
        return canvas.toDataURL('image/jpeg', 0.72);
    };

    app.saveCurrentTemplate = function () {
        var name = window.prompt('给这个模板起个名字', '我的模板');
        if (name === null) return;
        name = name.trim().slice(0, 30);
        if (!name) {
            app.toast('模板名称不能为空');
            return;
        }
        try {
            app.templateLibrary.save({
                id: app.createId('custom-template'),
                name: name,
                category: '自定义',
                description: '保存于 ' + new Date().toLocaleDateString(),
                shapeKey: app.currentShapeKey,
                thumbnail: app.createTemplateThumbnail(),
                settings: {
                    density: app.wall.density,
                    gap: app.wall.gap,
                    placementMode: app.wall.placementMode,
                    matrixColumns: app.wall.matrixColumns,
                    photoShape: app.wall.photoShape,
                    smartPlacement: app.wall.smartPlacement,
                    mixedSizes: app.wall.mixedSizes,
                    rotationRange: app.wall.rotationRange
                }
            });
            document.getElementById('template-category').value = '自定义';
            document.getElementById('template-search').value = '';
            app.renderLayoutPresets();
            app.toast('模板已保存到本机');
        } catch (error) {
            console.error(error);
            app.toast('模板保存失败，本地存储空间可能不足');
        }
    };

    app.deleteCustomTemplate = function (id) {
        if (!id || !app.templateLibrary.remove(id)) return;
        app.renderLayoutPresets();
        app.toast('自定义模板已删除');
    };

    app.reindexOverlays = function () {
        app.overlays.forEach(function (overlay, index) { overlay.zIndex = index; });
        app.wall.setOverlays(app.overlays);
    };

    app.addOverlay = function (type, content, overrides) {
        app.recordHistory();
        var overlay = createOverlay(type, app.createId('overlay'), content,
            Object.assign({ x: 0.5, y: 0.18, zIndex: app.overlays.length }, overrides || {}));
        app.overlays.push(overlay);
        app.selectedOverlayId = overlay.id;
        app.reindexOverlays();
        app.wall.selectOverlay(overlay.id);
        app.renderLayers();
        app.toast(type === 'sticker' ? '贴纸已添加，可在画布拖动' : '文字图层已添加，可在画布拖动');
    };

    app.updateBorderOverlay = function () {
        var style = document.getElementById('border-style').value;
        var color = document.getElementById('border-color').value;
        var existing = app.overlays.find(function (overlay) { return overlay.type === 'border'; });
        if (style === 'none' && !existing) return;
        app.recordHistory();
        if (style === 'none') {
            app.overlays = app.overlays.filter(function (overlay) { return overlay.type !== 'border'; });
            if (app.selectedOverlayId === existing.id) app.selectedOverlayId = null;
        } else if (existing) {
            existing.borderStyle = style;
            existing.color = color;
            existing.visible = true;
        } else {
            existing = createOverlay('border', app.createId('overlay'), '', {
                role: 'border', color: color, borderStyle: style, zIndex: app.overlays.length
            });
            app.overlays.push(existing);
            app.selectedOverlayId = existing.id;
        }
        app.reindexOverlays();
        app.wall.selectOverlay(app.selectedOverlayId);
        app.renderLayers();
    };

    app.removeBorderOverlay = function () {
        var border = app.overlays.find(function (overlay) { return overlay.type === 'border'; });
        if (border) app.deleteOverlay(border.id);
    };

    app.deleteOverlay = function (id) {
        var index = app.overlays.findIndex(function (overlay) { return overlay.id === id; });
        if (index < 0) return false;
        var removed = app.overlays[index];
        app.recordHistory();
        app.overlays.splice(index, 1);
        if (app.selectedOverlayId === id) app.selectedOverlayId = null;
        app.reindexOverlays();
        app.wall.selectOverlay(app.selectedOverlayId);
        app.renderLayers();
        app.toast(removed.type === 'border' ? '边框已移除' : removed.type === 'sticker' ? '贴纸已删除' : '图层已删除');
        return true;
    };

    app.selectOverlay = function (id) {
        app.selectedOverlayId = id;
        app.wall.selectOverlay(id);
        app.renderLayers();
    };

    app.handleLayerAction = function (event) {
        var item = event.target.closest('.layer-item');
        if (!item) return;
        var id = item.getAttribute('data-layer-id');
        var actionButton = event.target.closest('[data-layer-action]');
        if (!actionButton) {
            app.selectOverlay(id);
            return;
        }
        event.stopPropagation();
        var action = actionButton.getAttribute('data-layer-action');
        var index = app.overlays.findIndex(function (overlay) { return overlay.id === id; });
        if (index < 0) return;
        if (action === 'delete') {
            app.deleteOverlay(id);
            return;
        }
        app.recordHistory();
        if (action === 'visibility') {
            app.overlays[index].visible = app.overlays[index].visible === false;
        } else if (action === 'up' && index < app.overlays.length - 1) {
            var upper = app.overlays[index + 1]; app.overlays[index + 1] = app.overlays[index]; app.overlays[index] = upper;
        } else if (action === 'down' && index > 0) {
            var lower = app.overlays[index - 1]; app.overlays[index - 1] = app.overlays[index]; app.overlays[index] = lower;
        }
        app.reindexOverlays();
        app.wall.selectOverlay(app.selectedOverlayId);
        app.renderLayers();
    };

    app.updateSelectedOverlay = function () {
        var overlay = app.overlays.find(function (item) { return item.id === app.selectedOverlayId; });
        if (!overlay || overlay.type === 'border') return;
        overlay.content = document.getElementById('overlay-content').value.slice(0, 120);
        overlay.fontSize = Number(document.getElementById('overlay-size').value) || overlay.fontSize;
        overlay.color = document.getElementById('overlay-color').value;
        app.wall.render();
        app.renderLayers(false);
    };

    app.renderLayers = function (syncInspector) {
        if (syncInspector === undefined) syncInspector = true;
        var list = document.getElementById('layer-list');
        if (!list) return;
        document.getElementById('layer-count').textContent = app.overlays.length + ' 层';
        list.innerHTML = app.overlays.slice().reverse().map(function (overlay) {
            var name = overlay.type === 'border' ? '边框 · ' + overlay.borderStyle :
                (overlay.role === 'date' ? '日期 · ' : overlay.type === 'sticker' ? '贴纸 · ' : '文字 · ') + overlay.content;
            return '<div class="layer-item' + (overlay.id === app.selectedOverlayId ? ' active' : '') +
                '" data-layer-id="' + app.escapeHTML(overlay.id) + '"><span class="layer-item-name">' +
                app.escapeHTML(name) + '</span><button type="button" data-layer-action="visibility" title="显示/隐藏">' +
                (overlay.visible === false ? '○' : '●') + '</button><button type="button" data-layer-action="up" title="上移">↑</button>' +
                '<button type="button" data-layer-action="down" title="下移">↓</button>' +
                '<button type="button" data-layer-action="delete" title="删除">×</button></div>';
        }).join('');
        var border = app.overlays.find(function (overlay) { return overlay.type === 'border'; });
        document.getElementById('border-style').value = border ? border.borderStyle : 'none';
        if (border) document.getElementById('border-color').value = border.color;
        document.getElementById('border-remove-btn').hidden = !border;
        var selected = app.overlays.find(function (overlay) { return overlay.id === app.selectedOverlayId; });
        var inspector = document.getElementById('overlay-inspector');
        inspector.hidden = !selected || selected.type === 'border';
        if (syncInspector && selected && selected.type !== 'border') {
            document.getElementById('overlay-content').value = selected.content;
            document.getElementById('overlay-size').value = selected.fontSize;
            document.getElementById('overlay-color').value = selected.color;
        }
    };

    /* ------------------------------------------------------------------ *
     *  Photo handling
     * ------------------------------------------------------------------ */

    app.createId = function (prefix) {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') return prefix + '-' + window.crypto.randomUUID();
        return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    };

    app.isVideoFile = function (file) {
        return Boolean(file) && (app.supportedVideoTypes.indexOf(file.type) >= 0 || /\.(mp4|webm|mov|m4v|mkv|avi|3gp|mpeg|mpg)$/i.test(file.name || ''));
    };

    app.videoMimeForFile = function (file) {
        if (file && /^video\//i.test(file.type)) return file.type;
        var extension = ((file && file.name) || '').split('.').pop().toLowerCase();
        return {
            mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/x-m4v',
            mkv: 'video/x-matroska', avi: 'video/x-msvideo', '3gp': 'video/3gpp',
            mpeg: 'video/mpeg', mpg: 'video/mpeg'
        }[extension] || 'video/mp4';
    };

    app.handleFiles = function (files) {
        var loadToken = ++app._fileLoadToken;
        var incoming = Array.prototype.slice.call(files);
        var existingSignatures = new Set(app.photos.map(function (photo) { return photo.signature; }).filter(Boolean));
        var skippedLarge = 0, skippedDuplicate = 0;
        var mediaFiles = [];
        incoming.forEach(function (file) {
            var video = app.isVideoFile(file);
            var supportedType = app.supportedImageTypes.indexOf(file.type) >= 0 || video;
            var supportedExtension = /\.(jpe?g|png|webp|mp4|webm|mov|m4v|mkv|avi|3gp|mpeg|mpg)$/i.test(file.name);
            if (!supportedType && !supportedExtension) return;
            if (file.size > (video ? app.maxVideoFileSize : app.maxFileSize)) { skippedLarge++; return; }
            var signature = [file.name, file.size, file.lastModified].join(':');
            if (existingSignatures.has(signature)) { skippedDuplicate++; return; }
            existingSignatures.add(signature);
            mediaFiles.push(file);
        });
        var remaining = Math.max(0, app.maxPhotos - app.photos.length);
        var skippedLimit = Math.max(0, mediaFiles.length - remaining);
        mediaFiles = mediaFiles.slice(0, remaining);
        if (mediaFiles.length === 0) {
            if (!remaining) app.toast('最多支持 ' + app.maxPhotos + ' 个素材');
            else if (skippedDuplicate) app.toast('这些素材已经添加过了');
            else if (skippedLarge) app.toast('照片不能超过 40 MB，视频不能超过 200 MB');
            else app.toast('请选择常见照片或视频文件（JPG、PNG、MP4、MOV、MKV 等）');
            return;
        }
        app.stopAllPlayback(true);

        var total = mediaFiles.length;
        if (app.deviceProfile.mobile && app.photos.length + total > app.deviceProfile.recommendedPhotoCount) {
            app.toast('手机端建议不超过 ' + app.deviceProfile.recommendedPhotoCount + ' 个素材；编辑预览会降采样，原文件仍保留');
        }
        var importDimension = app.getPhotoImportDimension(app.photos.length + total);
        app.showLoading(true, '正在读取 0/' + total + ' 个素材…');
        app.loadPhotoBatch(mediaFiles, function (completed) {
            if (loadToken !== app._fileLoadToken) return;
            app.showLoading(true, '正在读取 ' + completed + '/' + total + ' 个素材…');
        }, importDimension).then(function (loadedPhotos) {
            if (loadToken !== app._fileLoadToken) return;
            var valid = loadedPhotos.filter(Boolean);
            if (valid.length) app.recordHistory();
            Array.prototype.push.apply(app.photos, valid);
            app.updatePhotoCount();
            app.renderPhotoLibrary();
            app.wall.setPhotos(app.photos);
            if (app.photos.length) app.hideEmptyState();
            if (valid.length && window.matchMedia('(max-width: 768px)').matches && app.closeMobileSidebar) {
                app.closeMobileSidebar();
            }
            app.showLoading(false);
            var skipped = skippedLarge + skippedDuplicate + skippedLimit + (total - valid.length);
            var fallbackVideos = valid.filter(function (photo) { return photo.posterFallback; }).length;
            app.toast('已添加 ' + valid.length + ' 个素材' + (skipped ? ' · 跳过 ' + skipped + ' 个' : '') +
                (fallbackVideos ? ' · 正在兼容 ' + fallbackVideos + ' 个视频' : ''));
            app.prepareIncompatibleVideos(valid);
        }).catch(function (err) {
            if (loadToken !== app._fileLoadToken) return;
            console.error('批量读取素材失败:', err);
            app.showLoading(false);
            app.toast('素材读取失败，请重试');
        });
    };

    app.loadPhotoBatch = function (files, onProgress, maxDimension) {
        var results = new Array(files.length);
        var nextIndex = 0;
        var completed = 0;
        var workerCount = Math.min(app.photoLoadConcurrency, files.length);

        function runWorker() {
            var index = nextIndex++;
            if (index >= files.length) return Promise.resolve();
            return app.loadPhoto(files[index], maxDimension).then(function (photo) {
                results[index] = photo;
            }).catch(function (err) {
                console.error('素材加载失败:', files[index].name, err);
                results[index] = null;
            }).then(function () {
                completed++;
                if (onProgress) onProgress(completed, files.length);
                return runWorker();
            });
        }

        var workers = [];
        for (var i = 0; i < workerCount; i++) workers.push(runWorker());
        return Promise.all(workers).then(function () { return results; });
    };

    app.loadPhoto = function (file, maxDimension) {
        return new Promise(function (resolve, reject) {
            var img = null;
            var objectURL = '';
            var layers = null;
            var settled = false;
            var timeout = setTimeout(function () {
                if (settled) return;
                settled = true;
                if (img) {
                    img.onload = null;
                    img.onerror = null;
                    img.src = '';
                }
                if (objectURL) URL.revokeObjectURL(objectURL);
                reject(new Error('load timed out'));
            }, app.photoLoadTimeout);

            function finish(callback, value) {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                if (img) {
                    img.onload = null;
                    img.onerror = null;
                }
                callback(value);
            }

            function createPhoto(loadedImage, source) {
                if (settled) return;
                Promise.all([app.analyzeLoadedPhoto(loadedImage, fileBlob), readCaptureTime(file)]).then(function (results) {
                    var analysis = results[0];
                    var photo = {
                        id: app.createId('photo'),
                        img: loadedImage,
                        src: source,
                        blob: fileBlob,
                        name: file.name,
                        signature: [file.name, file.size, file.lastModified].join(':'),
                        r: analysis.r,
                        g: analysis.g,
                        b: analysis.b,
                        brightness: analysis.brightness,
                        hue: analysis.hue,
                        saturation: analysis.saturation,
                        contrast: analysis.contrast,
                        sharpness: analysis.sharpness,
                        focusX: analysis.focusX,
                        focusY: analysis.focusY,
                        focusSource: analysis.focusSource || 'saliency',
                        subjectScore: Number(analysis.subjectScore) || 0,
                        subjectConfidence: Number(analysis.subjectConfidence) || 0,
                        faceBox: analysis.faceBox || null,
                        faceBoxes: analysis.faceBoxes || (analysis.faceBox ? [analysis.faceBox] : []),
                        faceGroupBox: analysis.faceGroupBox || analysis.faceBox || null,
                        faceCount: Number(analysis.faceCount) || 0,
                        personBox: analysis.personBox || null,
                        captureTime: results[1] || null,
                        analysisVersion: 2,
                        aspectRatio: analysis.aspectRatio,
                        mediaType: layers.mediaType || 'image',
                        videoMime: layers.videoMime || '',
                        duration: Number(layers.duration) || 0,
                        posterFallback: layers.posterFallback === true,
                        featured: false
                    };
                    app.assetManager.hydratePhoto(photo, layers);
                    if (objectURL) {
                        URL.revokeObjectURL(objectURL);
                        objectURL = '';
                    }
                    finish(resolve, photo);
                }).catch(function (err) {
                    if (objectURL) {
                        URL.revokeObjectURL(objectURL);
                        objectURL = '';
                    }
                    finish(reject, err);
                });
            }

            var fileBlob = null;
            app.createPhotoBlob(file, maxDimension).then(function (result) {
                if (settled) return;
                layers = result;
                fileBlob = result.workingBlob;
                objectURL = URL.createObjectURL(fileBlob);
                img = new Image();
                img.onload = function () {
                    createPhoto(img, objectURL);
                };
                img.onerror = function () { finish(reject, new Error('decode failed')); };
                img.src = objectURL;
            }).catch(function (error) {
                finish(reject, error);
            });
        });
    };

    app.analyzeLoadedPhoto = function (image, blob) {
        var analysisPromise = !app.photoAnalyzerWorker ? Promise.resolve(analyzePhoto(image)) :
            app.photoAnalyzerWorker.analyze(blob).catch(function () {
            return analyzePhoto(image);
        });
        return analysisPromise.then(function (analysis) {
            return refineSubjectFocus(image, analysis);
        });
    };

    /** Android WebView codec support is narrower than the device media stack.
     * Convert only incompatible clips, serially, while keeping originals for
     * project saving and system playback. */
    app.prepareIncompatibleVideos = function (photos) {
        if (!isAndroidNativeApp()) return Promise.resolve([]);
        var candidates = (Array.isArray(photos) ? photos : []).filter(function (photo) {
            return photo && photo.mediaType === 'video' &&
                (photo.posterFallback === true || photo.playbackStatus === 'decode-error') &&
                !photo.playbackBlob && photo.originalBlob instanceof Blob;
        });
        if (!candidates.length) return Promise.resolve([]);
        var prepared = [];
        app.videoCompatibilityQueue = app.videoCompatibilityQueue.catch(function () {}).then(async function () {
            for (var index = 0; index < candidates.length; index++) {
                var photo = candidates[index];
                if (app.photos.indexOf(photo) < 0) continue;
                photo.playbackStatus = 'converting';
                app.renderPhotoLibrary();
                try {
                    var copy = await transcodeVideoForAndroidPlayback(photo.originalBlob, {
                        name: photo.name,
                        onStatus: function (status) {
                            var canvasStatus = document.getElementById('canvas-status');
                            if (canvasStatus && status && status.message) canvasStatus.textContent = status.message;
                        }
                    });
                    if (app.photos.indexOf(photo) < 0) continue;
                    photo.playbackBlob = copy;
                    photo.playbackStatus = 'ready';
                    prepared.push(photo);
                    if (app.videoPlayer) app.videoPlayer.retry(photo);
                } catch (error) {
                    console.warn('视频兼容副本生成失败:', photo.name, error);
                    photo.playbackStatus = 'poster';
                }
                app.renderPhotoLibrary();
                if (app.videoPlayer) app.videoPlayer.sync(app.photos);
                if (app.wall) app.wall.render();
            }
            var canvasStatus = document.getElementById('canvas-status');
            if (canvasStatus && app.wall) {
                canvasStatus.textContent = app.photos.length + ' 个素材 · ' + app.wall.layout.length + ' 个填充格位 · 本地处理';
            }
            if (prepared.length) app.toast(prepared.length + ' 个视频已可在框位中播放');
            return prepared;
        });
        return app.videoCompatibilityQueue;
    };

    app.getPhotoImportDimension = function (projectedCount) {
        return getImportDimension(app.deviceProfile, projectedCount);
    };

    app.createPhotoBlob = function (file, maxDimension) {
        maxDimension = Math.max(320, Math.min(app.maxPhotoDimension, Number(maxDimension) || app.maxPhotoDimension));
        if (app.isVideoFile(file)) {
            var videoBlob = /^video\//i.test(file.type) ? file : file.slice(0, file.size, app.videoMimeForFile(file));
            return app.assetManager.createVideoLayers(videoBlob, maxDimension);
        }
        return app.assetManager.createLayers(file, maxDimension);
    };

    app.createImageBitmapFallback = function (blob) {
        return new Promise(function (resolve, reject) {
            var url = URL.createObjectURL(blob);
            var image = new Image();
            image.onload = function () {
                URL.revokeObjectURL(url);
                resolve(image);
            };
            image.onerror = function () {
                URL.revokeObjectURL(url);
                reject(new Error('image decode failed'));
            };
            image.src = url;
        });
    };

    app.clearPhotos = function () {
        if (app.photos.length === 0) return;
        if (!window.confirm('确定清空全部 ' + app.photos.length + ' 个素材吗？此操作可以撤销。')) return;
        app.stopAllPlayback(true);
        app.recordHistory();
        app.photos.forEach(function (photo) { app.assetManager.releasePhoto(photo); });
        if (app.videoPlayer) app.videoPlayer.sync([]);
        app.photos = [];
        app.updatePhotoCount();
        app.wall.setPhotos([]);
        app.renderPhotoLibrary();
        app.showEmptyState();
        app.toast('已清空全部素材');
    };

    app.updatePhotoCount = function () {
        document.getElementById('photo-count').textContent = app.photos.length;
        var videoCount = app.photos.reduce(function (total, photo) {
            return total + (photo.mediaType === 'video' ? 1 : 0);
        }, 0);
        var summary = document.getElementById('media-count-summary');
        if (summary) summary.textContent = (app.photos.length - videoCount) + ' 张照片 · ' + videoCount + ' 个视频';
        app.updateActionState();
    };

    app.renderPhotoLibrary = function () {
        if (app.photoLibrary) app.photoLibrary.render(app.photos);
    };

    app.reorderPhoto = function (fromIndex, targetIndex) {
        if (!app.photos[fromIndex] || !app.photos[targetIndex]) return;
        app.stopAllPlayback(true);
        app.recordHistory();
        var moved = app.photos.splice(fromIndex, 1)[0];
        app.photos.splice(targetIndex, 0, moved);
        app.renderPhotoLibrary();
        app.wall.setPhotos(app.photos);
        app.toast('照片顺序已更新');
    };

    app.toggleFeaturedPhoto = function (index) {
        if (!app.photos[index]) return;
        app.stopAllPlayback(true);
        app.recordHistory();
        app.photos[index].featured = !app.photos[index].featured;
        app.renderPhotoLibrary();
        app.wall.setPhotos(app.photos);
        app.toast(app.photos[index].featured ? '已设为重点照片，将优先显示为大图' : '已取消重点照片');
    };

    app.removePhoto = function (index) {
        if (!app.photos[index]) return;
        app.stopAllPlayback(true);
        app.recordHistory();
        var removed = app.photos.splice(index, 1)[0];
        app.assetManager.releasePhoto(removed);
        if (app.videoPlayer) app.videoPlayer.release(removed);
        app.updatePhotoCount();
        app.renderPhotoLibrary();
        app.wall.setPhotos(app.photos);
        if (!app.photos.length) app.showEmptyState();
        app.toast('已移除照片');
    };

    /* ------------------------------------------------------------------ *
     *  Portable project files
     * ------------------------------------------------------------------ */

    app.captureAutosaveSnapshot = function () {
        return {
            project: app.serializeProject(),
            photos: app.photos.slice()
        };
    };

    app.tryRestoreAutosave = function () {
        if (!app.autosave || !app.autosave.available) return;
        app.autosave.loadLatest().then(function (snapshot) {
            if (!snapshot || !snapshot.project || !snapshot.project.photos.length || app.photos.length) return;
            var savedAt = snapshot.savedAt ? new Date(snapshot.savedAt) : null;
            var timeLabel = savedAt && !Number.isNaN(savedAt.getTime()) ?
                savedAt.toLocaleString() : '上次使用时';
            if (!window.confirm('检测到 ' + timeLabel + ' 的自动保存项目，是否恢复？')) {
                return app.autosave.clear();
            }
            app.autosaveRestoring = true;
            app.autosave.suspend();
            var skipped = Number(snapshot.skippedPhotoCount) || 0;
            return app.restoreProject(snapshot.project, {
                successMessage: '已从自动保存恢复 · ' + snapshot.project.photos.length + ' 个素材' +
                    (skipped ? ' · 跳过 ' + skipped + ' 个损坏项' : '')
            }).finally(function () {
                app.autosaveRestoring = false;
                app.autosave.resume();
            });
        }).catch(function (error) {
            app.autosaveRestoring = false;
            app.autosave.resume();
            console.warn('读取自动保存失败:', error);
            app.showLoading(false);
            app.toast('自动保存内容无法恢复，可继续新建项目');
        });
    };

    app.serializeProject = function (photoSources) {
        var shape = Shapes[app.currentShapeKey];
        var shapeData = { key: app.currentShapeKey, name: shape && shape.name };
        if (shape && shape.maskCanvas) {
            shapeData.dynamic = true;
            shapeData.maskDataURL = shape.maskCanvas.toDataURL('image/png');
            shapeData.maskWidth = shape.maskCanvasW || shape.maskCanvas.width;
            shapeData.maskHeight = shape.maskCanvasH || shape.maskCanvas.height;
        }
        return {
            format: 'photo-wall-project',
            version: 2,
            savedAt: new Date().toISOString(),
            shape: shapeData,
            settings: {
                density: app.wall.density,
                gap: app.wall.gap,
                placementMode: app.wall.placementMode,
                matrixColumns: app.wall.matrixColumns,
                photoShape: app.wall.photoShape,
                smartPlacement: app.wall.smartPlacement,
                mixedSizes: app.wall.mixedSizes,
                rotationRange: app.wall.rotationRange,
                layoutSeed: app.wall.layoutSeed,
                playbackMode: app.playbackMode,
                playbackOrder: app.playbackOrder,
                playbackTransition: app.playbackTransition,
                customOrigin: app.customOrigin ? Object.assign({}, app.customOrigin) : null
            },
            photos: app.photos.map(function (photo, index) {
                return {
                    id: photo.id,
                    src: photoSources ? photoSources[index] : photo.src,
                    name: photo.name,
                    signature: photo.signature,
                    r: photo.r,
                    g: photo.g,
                    b: photo.b,
                    brightness: photo.brightness,
                    hue: photo.hue,
                    saturation: photo.saturation,
                    contrast: photo.contrast,
                    sharpness: photo.sharpness,
                    focusX: photo.focusX,
                    focusY: photo.focusY,
                    focusSource: photo.focusSource,
                    subjectScore: photo.subjectScore,
                    subjectConfidence: photo.subjectConfidence,
                    faceBox: photo.faceBox || null,
                    faceBoxes: photo.faceBoxes || [],
                    faceGroupBox: photo.faceGroupBox || null,
                    faceCount: Number(photo.faceCount) || 0,
                    personBox: photo.personBox || null,
                    captureTime: photo.captureTime || null,
                    analysisVersion: Number(photo.analysisVersion) || 1,
                    aspectRatio: photo.aspectRatio,
                    mediaType: photo.mediaType || 'image',
                    videoMime: photo.videoMime || '',
                    duration: Number(photo.duration) || 0,
                    posterFallback: photo.posterFallback === true,
                    featured: photo.featured === true,
                    editZoom: photo.editZoom,
                    editOffsetX: photo.editOffsetX,
                    editOffsetY: photo.editOffsetY,
                    editRotation: photo.editRotation,
                    flipX: photo.flipX === true,
                    flipY: photo.flipY === true,
                    originalWidth: photo.originalWidth,
                    originalHeight: photo.originalHeight
                };
            }),
            overlays: app.overlays.map(function (overlay) { return Object.assign({}, overlay); }),
            backgroundMusic: app.backgroundMusic ? Object.assign({}, app.backgroundMusic) : null,
            layout: app.wall.getLayoutSnapshot()
        };
    };

    app.saveProject = function () {
        if (!app.photos.length) {
            app.toast('请先添加照片');
            return;
        }
        app.showLoading(true, '正在打包项目…');
        var project = app.serializeProject();
        Promise.resolve(app.autosave && app.autosave.createBackup('保存项目之前')).then(function () {
            return createProjectContainer(project, app.photos, {
                appVersion: '1.0.0',
                backgroundMusic: app.backgroundMusic
            });
        }).then(function (blob) {
            var rawName = document.getElementById('export-name').value.trim() || '我的照片墙';
            var name = rawName.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').replace(/[. ]+$/, '') || '我的照片墙';
            return saveBlob(blob, {
                title: '保存照片墙项目',
                fileName: name + '.photowall',
                filters: [{ name: '照片墙项目', extensions: ['photowall'] }]
            }).then(function (result) {
                app.showLoading(false);
                if (result.cancelled) app.toast('已取消保存');
                else app.toast('项目已保存，可继续编辑');
            });
        }).catch(function (error) {
            console.error(error);
            app.showLoading(false);
            app.toast('项目保存失败');
        });
    };

    app.blobToDataURL = function (blob) {
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function () { resolve(reader.result); };
            reader.onerror = function () { reject(new Error('blob encode failed')); };
            reader.readAsDataURL(blob);
        });
    };

    app.mapWithConcurrency = function (items, concurrency, mapper, onProgress) {
        var results = new Array(items.length);
        var nextIndex = 0;
        var completed = 0;
        var count = Math.min(Math.max(1, concurrency), Math.max(1, items.length));
        function run() {
            var index = nextIndex++;
            if (index >= items.length) return Promise.resolve();
            return Promise.resolve(mapper(items[index], index)).then(function (result) {
                results[index] = result;
                completed++;
                if (onProgress) onProgress(completed, items.length);
                return run();
            });
        }
        var workers = [];
        for (var i = 0; i < count; i++) workers.push(run());
        return Promise.all(workers).then(function () { return results; });
    };

    app.openProject = function (file) {
        if (!file || file.size > 1024 * 1024 * 1024) {
            app.toast('项目文件无效或超过 1 GB');
            return;
        }
        app.stopAllPlayback(true);
        app.showLoading(true, '正在打开项目…');
        file.arrayBuffer().then(function (buffer) {
            var bytes = new Uint8Array(buffer);
            if (isPhotowallContainer(bytes)) return openProjectContainer(bytes).then(function (result) { return result.project; });
            var legacy = JSON.parse(new TextDecoder().decode(bytes));
            return migrateProject(legacy);
        }).then(function (project) {
            if (project.photos.length > app.maxPhotos) throw new Error('too many photos');
            return app.restoreProject(project);
        }).catch(function (error) {
            console.error(error);
            app.showLoading(false);
            app.toast('项目内容损坏、版本不兼容或图片无法读取');
        });
    };

    app.restoreLatestBackup = function () {
        if (!app.autosave || !app.autosave.available) {
            app.toast('当前环境不支持本地备份');
            return;
        }
        app.autosave.listBackups().then(function (backups) {
            if (!backups.length) {
                app.toast('还没有可恢复的手动备份');
                return null;
            }
            var latest = backups[0];
            var label = new Date(latest.savedAt).toLocaleString();
            if (!window.confirm('恢复 ' + label + ' 的最近备份？当前未保存改动仍可通过自动保存找回。')) return null;
            app.showLoading(true, '正在恢复本地备份…');
            return app.autosave.loadBackup(latest.id).then(function (backup) {
                if (!backup) throw new Error('backup missing');
                return app.restoreProject(backup.project, { successMessage: '本地备份已恢复' });
            });
        }).catch(function (error) {
            console.error(error);
            app.showLoading(false);
            app.toast('本地备份恢复失败');
        });
    };

    app.loadProjectPhoto = function (saved, maxDimension) {
        var storedBlob = saved && (saved.originalBlob || saved.blob);
        var hasBlob = typeof Blob !== 'undefined' && storedBlob instanceof Blob;
        var hasDataURL = saved && typeof saved.src === 'string' &&
            /^data:image\/(jpeg|jpg|png|webp);base64,/i.test(saved.src);
        if (!hasBlob && !hasDataURL) return Promise.reject(new Error('invalid photo source'));
        var blobPromise = hasBlob ? Promise.resolve(storedBlob) : fetch(saved.src).then(function (response) {
            if (!response.ok) throw new Error('project photo read failed');
            return response.blob();
        });
        return blobPromise.then(function (originalBlob) {
            var video = saved.mediaType === 'video' || /^video\//i.test(originalBlob.type);
            return video ? app.assetManager.createVideoLayers(originalBlob, maxDimension || app.maxPhotoDimension) :
                app.assetManager.createLayers(originalBlob, maxDimension || app.maxPhotoDimension);
        }).then(function (layers) {
            return new Promise(function (resolve, reject) {
                var img = new Image();
                var objectURL = URL.createObjectURL(layers.workingBlob);
                var settled = false;
                var timeout = setTimeout(function () {
                    if (settled) return;
                    settled = true;
                    img.onload = null;
                    img.onerror = null;
                    img.src = '';
                    URL.revokeObjectURL(objectURL);
                    reject(new Error('project photo load timed out'));
                }, app.photoLoadTimeout);

                function finish(callback, value) {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timeout);
                    img.onload = null;
                    img.onerror = null;
                    URL.revokeObjectURL(objectURL);
                    callback(value);
                }

                img.onload = function () {
                    try {
                        var analysisFields = [
                            'r', 'g', 'b', 'brightness', 'hue', 'saturation',
                            'contrast', 'sharpness', 'focusX', 'focusY', 'aspectRatio'
                        ];
                        var needsAnalysis = analysisFields.some(function (field) {
                            return !Number.isFinite(saved[field]);
                        }) || Number(saved.analysisVersion) < 2;
                        var analysis = needsAnalysis ? analyzePhoto(img) : saved;
                        var photo = {
                            id: saved.id || app.createId('photo'),
                            img: img,
                            src: objectURL,
                            blob: layers.workingBlob,
                            name: saved.name || '未命名照片',
                            signature: saved.signature || '',
                            r: Number.isFinite(saved.r) ? saved.r : analysis.r,
                            g: Number.isFinite(saved.g) ? saved.g : analysis.g,
                            b: Number.isFinite(saved.b) ? saved.b : analysis.b,
                            brightness: Number.isFinite(saved.brightness) ? saved.brightness : analysis.brightness,
                            hue: Number.isFinite(saved.hue) ? saved.hue : analysis.hue,
                            saturation: Number.isFinite(saved.saturation) ? saved.saturation : analysis.saturation,
                            contrast: Number.isFinite(saved.contrast) ? saved.contrast : analysis.contrast,
                            sharpness: Number.isFinite(saved.sharpness) ? saved.sharpness : analysis.sharpness,
                            focusX: !needsAnalysis && Number.isFinite(saved.focusX) ? saved.focusX : analysis.focusX,
                            focusY: !needsAnalysis && Number.isFinite(saved.focusY) ? saved.focusY : analysis.focusY,
                            focusSource: !needsAnalysis && saved.focusSource ? saved.focusSource : (analysis.focusSource || 'saliency'),
                            subjectScore: !needsAnalysis ? (Number(saved.subjectScore) || 0) : (Number(analysis.subjectScore) || 0),
                            subjectConfidence: !needsAnalysis ? (Number(saved.subjectConfidence) || 0) : (Number(analysis.subjectConfidence) || 0),
                            faceBox: (!needsAnalysis ? saved.faceBox : analysis.faceBox) || null,
                            faceBoxes: (!needsAnalysis ? saved.faceBoxes : analysis.faceBoxes) || [],
                            faceGroupBox: (!needsAnalysis ? saved.faceGroupBox : analysis.faceGroupBox) || null,
                            faceCount: Number(!needsAnalysis ? saved.faceCount : analysis.faceCount) || 0,
                            personBox: (!needsAnalysis ? saved.personBox : analysis.personBox) || null,
                            captureTime: saved.captureTime || null,
                            analysisVersion: 2,
                            aspectRatio: Number.isFinite(saved.aspectRatio) ? saved.aspectRatio : analysis.aspectRatio,
                            mediaType: layers.mediaType || saved.mediaType || 'image',
                            videoMime: layers.videoMime || saved.videoMime || '',
                            duration: Number(layers.duration || saved.duration) || 0,
                            posterFallback: layers.posterFallback === true || saved.posterFallback === true,
                            featured: saved.featured === true,
                            editZoom: Number.isFinite(saved.editZoom) ? saved.editZoom : 1,
                            editOffsetX: Number.isFinite(saved.editOffsetX) ? saved.editOffsetX : 0,
                            editOffsetY: Number.isFinite(saved.editOffsetY) ? saved.editOffsetY : 0,
                            editRotation: Number.isFinite(saved.editRotation) ? saved.editRotation : 0,
                            flipX: saved.flipX === true,
                            flipY: saved.flipY === true
                        };
                        app.assetManager.hydratePhoto(photo, layers);
                        URL.revokeObjectURL(objectURL);
                        finish(resolve, photo);
                    } catch (error) {
                        finish(reject, error);
                    }
                };
                img.onerror = function () { finish(reject, new Error('photo decode failed')); };
                img.src = objectURL;
            });
        });
    };

    app.loadProjectPhotoBatch = function (savedPhotos, onProgress) {
        var results = new Array(savedPhotos.length);
        var nextIndex = 0;
        var completed = 0;
        var workerCount = Math.min(app.photoLoadConcurrency, savedPhotos.length);
        var maxDimension = app.getPhotoImportDimension(savedPhotos.length);

        function runWorker() {
            var index = nextIndex++;
            if (index >= savedPhotos.length) return Promise.resolve();
            return app.loadProjectPhoto(savedPhotos[index], maxDimension).then(function (photo) {
                results[index] = photo;
                completed++;
                if (onProgress) onProgress(completed, savedPhotos.length);
                return runWorker();
            }).catch(function (err) {
                console.error('项目照片恢复失败:', savedPhotos[index] && savedPhotos[index].name, err);
                results[index] = null;
                completed++;
                if (onProgress) onProgress(completed, savedPhotos.length);
                return runWorker();
            });
        }

        var workers = [];
        for (var i = 0; i < workerCount; i++) workers.push(runWorker());
        return Promise.all(workers).then(function () { return results; });
    };

    app.restoreProjectShape = function (saved) {
        if (!saved || !saved.dynamic) {
            var builtInKey = saved && saved.key && Shapes[saved.key] ? saved.key : 'china';
            return Promise.resolve(builtInKey);
        }
        return new Promise(function (resolve, reject) {
            if (typeof saved.maskDataURL !== 'string' || !saved.maskDataURL.startsWith('data:image/png;base64,') ||
                saved.maskDataURL.length > 12 * 1024 * 1024) {
                reject(new Error('invalid shape mask'));
                return;
            }
            var img = new Image();
            img.onload = function () {
                var canvas = document.createElement('canvas');
                var shapeScale = Math.min(2048 / img.naturalWidth, 2048 / img.naturalHeight, 1);
                canvas.width = Math.max(1, Math.round(img.naturalWidth * shapeScale));
                canvas.height = Math.max(1, Math.round(img.naturalHeight * shapeScale));
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                var thumbWidth = 80;
                var thumbHeight = Math.max(1, Math.round(thumbWidth * canvas.height / canvas.width));
                var thumb = document.createElement('canvas');
                thumb.width = thumbWidth;
                thumb.height = thumbHeight;
                var thumbContext = thumb.getContext('2d');
                thumbContext.drawImage(canvas, 0, 0, thumbWidth, thumbHeight);
                var path = ShapeFactory._traceMask(thumbContext.getImageData(0, 0, thumbWidth, thumbHeight));
                var key = saved.key || app.createId('custom');
                Shapes.register(key, {
                    name: saved.name || '自定义形状',
                    viewBox: { width: 1000, height: Math.round(1000 * canvas.height / canvas.width) },
                    paths: [path || 'M0,0 L1,0 L1,1 L0,1 Z'],
                    thumbnailViewBox: { width: thumbWidth, height: thumbHeight },
                    maskCanvas: canvas,
                    maskCanvasW: canvas.width,
                    maskCanvasH: canvas.height,
                    dynamic: true
                });
                resolve(key);
            };
            img.onerror = function () { reject(new Error('shape decode failed')); };
            img.src = saved.maskDataURL;
        });
    };

    app.restoreProject = function (project, options) {
        options = options || {};
        /* Invalidate any in-flight import so its batch callback doesn't
           append old photos into the freshly restored project. */
        app._fileLoadToken++;
        var totalPhotos = project.photos.length;
        app.showLoading(true, '正在恢复 0/' + totalPhotos + ' 个素材…');
        return Promise.all([
            app.loadProjectPhotoBatch(project.photos, function (completed) {
                app.showLoading(true, '正在恢复 ' + completed + '/' + totalPhotos + ' 个素材…');
            }),
            app.restoreProjectShape(project.shape)
        ]).then(function (results) {
            var photos = results[0];
            var shapeKey = results[1];
            var settings = project.settings || {};
            /* Per-photo failures load as null; skip them instead of crashing
               on the id pass below so one broken JPEG doesn't kill the whole
               project restore. */
            var skippedPhotos = project.photos.length - photos.filter(Boolean).length;
            photos = photos.filter(Boolean);
            if (!photos.length) throw new Error('no photos could be restored');
            var usedIds = new Set();
            photos.forEach(function (photo) {
                if (!photo.id || usedIds.has(photo.id)) photo.id = app.createId('photo');
                usedIds.add(photo.id);
            });
            app.photos.forEach(function (photo) { app.assetManager.releasePhoto(photo); });
            app.history.clear();
            app.renderShapeButtons();
            if (Shapes[shapeKey] && Shapes[shapeKey].dynamic) app.addShapeButton(shapeKey, Shapes[shapeKey]);
            app.restoreState({
                photos: photos,
                shapeKey: shapeKey,
                density: Math.max(0.5, Math.min(1.5, Number(settings.density) || 1)),
                gap: Math.max(0, Math.min(0.12, Number(settings.gap) || 0)),
                placementMode: ['grid', 'brick', 'organic'].indexOf(settings.placementMode) >= 0 ? settings.placementMode : 'grid',
                matrixColumns: [2, 3, 4, 5, 6, 8].indexOf(Number(settings.matrixColumns)) >= 0 ? Number(settings.matrixColumns) : 0,
                photoShape: ['circle', 'square', 'diamond', 'hexagon', 'heart'].indexOf(settings.photoShape) >= 0 ? settings.photoShape : 'square',
                smartPlacement: settings.smartPlacement !== false,
                mixedSizes: settings.mixedSizes !== false,
                rotationRange: Math.max(0, Math.min(24, Number(settings.rotationRange) || 0)),
                layoutSeed: Number(settings.layoutSeed) || 1,
                playbackMode: settings.playbackMode === 'reveal' ? 'reveal' : 'shuffle',
                playbackOrder: PLAYBACK_ORDER_KEYS.indexOf(settings.playbackOrder) >= 0 ? settings.playbackOrder : 'center-out',
                playbackTransition: ['fade', 'zoom', 'slide', 'ken-burns'].indexOf(settings.playbackTransition) >= 0 ? settings.playbackTransition : 'zoom',
                customOrigin: settings.customOrigin && Number.isFinite(Number(settings.customOrigin.normalizedX)) &&
                    Number.isFinite(Number(settings.customOrigin.normalizedY)) ? {
                        normalizedX: Math.max(0, Math.min(1, Number(settings.customOrigin.normalizedX))),
                        normalizedY: Math.max(0, Math.min(1, Number(settings.customOrigin.normalizedY)))
                    } : null,
                backgroundMusic: project.backgroundMusic || null,
                overlays: normalizeOverlays(project.overlays),
                arrangement: [],
                layout: project.layout
            });
            app.showLoading(false);
            app.toast(options.successMessage || ('项目已恢复 · ' + photos.length + ' 个素材' +
                (skippedPhotos ? ' · 跳过 ' + skippedPhotos + ' 个无法读取的素材' : '')));
            app.prepareIncompatibleVideos(app.photos);
        });
    };

    /* ------------------------------------------------------------------ *
     *  History / product state
     * ------------------------------------------------------------------ */

    app.captureState = function () {
        return {
            photos: app.photos.map(function (photo) {
                var copy = Object.assign({}, photo);
                copy.img = null;
                return copy;
            }),
            shapeKey: app.currentShapeKey,
            density: app.wall.density,
            gap: app.wall.gap,
            placementMode: app.wall.placementMode,
            matrixColumns: app.wall.matrixColumns,
            photoShape: app.wall.photoShape,
            smartPlacement: app.wall.smartPlacement,
            mixedSizes: app.wall.mixedSizes,
            rotationRange: app.wall.rotationRange,
            layoutSeed: app.wall.layoutSeed,
            playbackMode: app.playbackMode,
            playbackOrder: app.playbackOrder,
            playbackTransition: app.playbackTransition,
            customOrigin: app.customOrigin ? Object.assign({}, app.customOrigin) : null,
            backgroundMusic: app.backgroundMusic ? Object.assign({}, app.backgroundMusic) : null,
            overlays: app.overlays.map(function (overlay) { return Object.assign({}, overlay); }),
            arrangement: app.wall.getArrangement(),
            layout: app.wall.getLayoutSnapshot()
        };
    };

    app.recordHistory = function (snapshot) {
        if (app.history && app.wall) app.history.record(snapshot);
        if (app.autosave && !app.autosaveRestoring) app.autosave.schedule();
    };

    app.restoreState = function (state) {
        if (!state) return;
        clearTimeout(app.localAdjustCommitTimer);
        app.localAdjustCommitTimer = null;
        app.localAdjustSnapshot = null;
        app.stopAllPlayback(false);
        clearTimeout(app.densityTimer);
        clearTimeout(app.overlapTimer);
        clearTimeout(app.rotationTimer);
        var restoredPhotoIds = new Set(state.photos.map(function (photo) { return photo.id; }));
        app.photos.forEach(function (photo) {
            if (!restoredPhotoIds.has(photo.id)) app.assetManager.releasePhoto(photo);
        });
        if (app.videoPlayer) app.videoPlayer.sync(state.photos);
        app.photos = state.photos.map(function (photo) {
            var restored = Object.assign({}, photo, { img: null });
            app.assetManager.attachURLs(restored);
            return restored;
        });
        app.currentShapeKey = state.shapeKey;

        app.wall.density = state.density;
        app.wall.gap = state.gap;
        app.wall.placementMode = state.placementMode;
        app.wall.matrixColumns = [2, 3, 4, 5, 6, 8].indexOf(Number(state.matrixColumns)) >= 0 ? Number(state.matrixColumns) : 0;
        app.wall.photoShape = state.photoShape;
        app.wall.smartPlacement = state.smartPlacement;
        app.wall.mixedSizes = state.mixedSizes !== false;
        app.wall.rotationRange = Number(state.rotationRange) || 0;
        app.wall.layoutSeed = Number(state.layoutSeed) || 1;
        app.playbackMode = state.playbackMode === 'reveal' ? 'reveal' : 'shuffle';
        app.playbackOrder = PLAYBACK_ORDER_KEYS.indexOf(state.playbackOrder) >= 0 ? state.playbackOrder : 'center-out';
        app.playbackTransition = ['fade', 'zoom', 'slide', 'ken-burns'].indexOf(state.playbackTransition) >= 0 ? state.playbackTransition : 'zoom';
        app.customOrigin = state.customOrigin && Number.isFinite(Number(state.customOrigin.normalizedX)) &&
            Number.isFinite(Number(state.customOrigin.normalizedY)) ? {
                normalizedX: Math.max(0, Math.min(1, Number(state.customOrigin.normalizedX))),
                normalizedY: Math.max(0, Math.min(1, Number(state.customOrigin.normalizedY)))
            } : null;
        app.releaseMusicAudio();
        app.backgroundMusic = normalizeBackgroundMusic(state.backgroundMusic);
        if (app.backgroundMusic && app.backgroundMusic.originalBlob) app.attachMusicAudio();
        app.overlays = normalizeOverlays(state.overlays);
        if (!app.overlays.some(function (overlay) { return overlay.id === app.selectedOverlayId; })) {
            app.selectedOverlayId = null;
        }
        app.wall.overlays = app.overlays;
        app.wall.selectedOverlayId = app.selectedOverlayId;
        app.wall.shapeKey = state.shapeKey;
        app.wall.shape = Shapes[state.shapeKey];
        app.wall.photos = app.photos;
        app.wall.generateLayout(false, true);
        if (!app.wall.setLayoutSnapshot(state.layout)) app.wall.setArrangement(state.arrangement);

        app.syncLayoutControls();
        document.getElementById('playback-mode').value = app.playbackMode;
        document.getElementById('playback-order').value = app.playbackOrder;
        document.getElementById('playback-transition').value = app.playbackTransition;
        document.getElementById('wall-canvas').classList.toggle('selecting-playback-origin',
            app.playbackOrder === 'custom' && !app.customOrigin);
        app.updateCustomOriginMarker();
        app.syncMusicControls();
        app.updatePhotoCount();
        app.renderPhotoLibrary();
        app.renderLayers();
        if (app.photos.length) app.hideEmptyState(); else app.showEmptyState();
        app.updateActionState();
        if (app.autosave && !app.autosaveRestoring) app.autosave.schedule();
    };

    app.undo = function () {
        app.stopAllPlayback(true);
        if (app.localAdjustSnapshot) app.commitLocalAdjust();
        if (app.history.undo()) app.toast('已撤销');
    };

    app.redo = function () {
        app.stopAllPlayback(true);
        if (app.localAdjustSnapshot) app.commitLocalAdjust();
        if (app.history.redo()) app.toast('已重做');
    };

    app.beginLocalAdjust = function () {
        if (!app.localAdjustSnapshot && app.wall) app.localAdjustSnapshot = app.captureState();
    };

    app.commitLocalAdjust = function (message) {
        clearTimeout(app.localAdjustCommitTimer);
        app.localAdjustCommitTimer = null;
        if (!app.localAdjustSnapshot) return false;
        app.recordHistory(app.localAdjustSnapshot);
        app.localAdjustSnapshot = null;
        if (message) app.toast(message);
        app.updateActionState();
        return true;
    };

    app.updateLocalAdjustControls = function () {
        var toolbar = document.getElementById('local-adjust-toolbar');
        if (!toolbar || !app.wall) return;
        var index = app.wall.localAdjustIndex;
        var item = app.wall.interactionMode === 'adjust' && index >= 0 ? app.wall.layout[index] : null;
        toolbar.hidden = !item;
        if (!item) return;
        var zoom = Math.max(1, Math.min(4, Number(item.localZoom) || 1));
        document.getElementById('local-adjust-name').textContent =
            item.photo && item.photo.name ? item.photo.name : '当前照片';
        document.getElementById('local-zoom-range').value = String(zoom);
        document.getElementById('local-zoom-value').textContent = Math.round(zoom * 100) + '%';
        document.getElementById('local-zoom-out').disabled = zoom <= 1.0001;
        document.getElementById('local-zoom-in').disabled = zoom >= 3.9999;
        document.getElementById('local-adjust-reset').disabled =
            zoom <= 1.0001 && Math.abs(Number(item.localOffsetX) || 0) < 0.0001 &&
            Math.abs(Number(item.localOffsetY) || 0) < 0.0001;
    };

    app.setSelectedLocalZoom = function (value) {
        var index = app.wall ? app.wall.localAdjustIndex : -1;
        var item = index >= 0 ? app.wall.layout[index] : null;
        if (!item) return false;
        var zoom = Math.max(1, Math.min(4, Number(value) || 1));
        if (Math.abs(zoom - (Number(item.localZoom) || 1)) < 0.0001) return false;
        app.beginLocalAdjust();
        if (!app.wall.setLocalZoom(index, zoom)) return false;
        app.updateLocalAdjustControls();
        return true;
    };

    app.stepSelectedLocalZoom = function (delta) {
        var index = app.wall ? app.wall.localAdjustIndex : -1;
        var item = index >= 0 ? app.wall.layout[index] : null;
        if (!item) return false;
        var current = Number(item.localZoom) || 1;
        return app.setSelectedLocalZoom(Math.round((current + delta) * 20) / 20);
    };

    app.setPositionMode = function (enabled) {
        if (enabled) app.stopAllPlayback(true);
        if (app.localAdjustSnapshot) app.commitLocalAdjust();
        else {
            clearTimeout(app.localAdjustCommitTimer);
            app.localAdjustCommitTimer = null;
        }
        app.wall.setInteractionMode(enabled ? 'adjust' : 'swap');
        var button = document.getElementById('position-mode-btn');
        button.classList.toggle('active', enabled);
        button.setAttribute('aria-pressed', String(enabled));
        button.title = enabled ? '选择照片后可拖动位置，并单独放大或缩小' : '在格位内移动和缩放照片以突出人物';
        document.getElementById('canvas-help').textContent = enabled ?
            '局部调图模式 · 点击照片后拖动位置，使用控件或滚轮缩放' :
            '拖拽素材可交换位置 · 开启局部调图后可移动和缩放单个格位';
        app.updateLocalAdjustControls();
    };

    app.flowTiming = function () {
        var speed = document.getElementById('flow-speed').value;
        return {
            slow: { interval: 5200, transition: 1200, stagger: 200 },
            normal: { interval: 3200, transition: 800, stagger: 120 },
            fast: { interval: 1800, transition: 500, stagger: 70 }
        }[speed] || { interval: 3200, transition: 800, stagger: 120 };
    };

    app.getPlaybackOrigin = function () {
        if (!app.customOrigin) return null;
        return {
            x: app.customOrigin.normalizedX * Math.max(1, app.wall.cssWidth),
            y: app.customOrigin.normalizedY * Math.max(1, app.wall.cssHeight)
        };
    };

    app.getPlaybackCycles = function () {
        var visibleCells = Math.max(1, app.wall && app.wall.layout ? app.wall.layout.length : 1);
        return Math.max(1, Math.ceil(app.photos.length / visibleCells));
    };

    app.updateCustomOriginMarker = function () {
        var marker = document.getElementById('playback-origin-marker');
        if (!marker || !app.customOrigin || app.playbackOrder !== 'custom') {
            if (marker) marker.classList.remove('visible');
            return;
        }
        marker.style.left = (app.customOrigin.normalizedX * 100) + '%';
        marker.style.top = (app.customOrigin.normalizedY * 100) + '%';
        marker.classList.add('visible');
    };

    /* ================================================================ */
    /* Unified playback controller (reveal + shuffle)                    */
    /* ================================================================ */

    app.startPlayback = function () {
        if (app.playbackOrder === 'custom' && !app.customOrigin) {
            document.getElementById('wall-canvas').classList.add('selecting-playback-origin');
            app.toast('请先在照片墙上点击播放起点');
            return;
        }
        var mode = app.playbackMode;
        if (mode === 'reveal') {
            app.startRevealPlayback();
        } else {
            app.startFlowPlayback();
        }
    };

    /**
     * Playback frames draw every visible cell synchronously, but the bitmap
     * LRU only holds a fraction of a large wall's photos. Warm the cache by
     * the render order before starting so late frames don't drop to blank
     * cells, and keep prefetching while the animation runs.
     */
    app._playbackPreloaderToken = 0;

    app.startPlaybackBitmapPreload = function (layout, preferredOrder) {
        var manager = app.assetManager;
        var wall = app.wall;
        if (!manager || !wall || !layout.length) return;
        if (wall._renderOrder.length !== layout.length) wall._refreshOrderCache();
        var order = Array.isArray(preferredOrder) && preferredOrder.length === layout.length ?
            preferredOrder.slice() : wall._renderOrder.slice();
        var token = ++app._playbackPreloaderToken;
        var cursor = 0;
        function next() {
            if (token !== app._playbackPreloaderToken || cursor >= order.length) return;
            var item = layout[order[cursor++]];
            var photo = item && item.photo;
            if (!photo) { next(); return; }
            /* Thumbnails are intentionally retained in a much larger, low-pixel
               cache. Warming full working images simply evicted earlier photos
               before playback reached them on Android. */
            manager.getBitmap(photo, 'thumbnail').catch(function () {}).then(function () {
                if (token === app._playbackPreloaderToken) next();
            });
        }
        next();
        next();
    };

    app.stopPlaybackBitmapPreload = function () {
        app._playbackPreloaderToken++;
    };

    app.stopAllPlayback = function (saveHistory) {
        app.stopPlaybackBitmapPreload();
        clearTimeout(app.flowTimer);
        app.flowTimer = null;
        if (app.revealRAF) cancelAnimationFrame(app.revealRAF);
        app.revealRAF = null;
        app.revealTimeline = null;
        if (saveHistory && app.flowCycleCount && app.flowSnapshot) app.recordHistory(app.flowSnapshot);
        app.flowPlaying = false;
        app.flowSnapshot = null;
        app.flowCycleCount = 0;
        app.stopMusicPlayback();
        if (app.wall) app.wall.clearPlayback();
        app.updateFlowControls();
    };

    /* ---- Reveal mode ---- */

    app.startRevealPlayback = function () {
        if (!app.photos.length || !app.wall.layout.length) {
            app.toast('至少需要一个素材才能播放');
            return;
        }
        app.setPositionMode(false);
        app.stopAllPlayback(false);
        app.revealTimeline = app.playbackController.createTimeline('reveal');
        app.startPlaybackBitmapPreload(app.wall.layout, app.revealTimeline.orderedIndices);
        app.revealStartTime = performance.now();
        app.flowPlaying = true; /* reuse the flag for button state */
        app.updateFlowControls();
        app.startMusicPlayback(app.revealTimeline.duration, false);
        app.runRevealFrame();
    };

    app.runRevealFrame = function () {
        if (!app.revealTimeline || !app.flowPlaying) return;
        var elapsed = performance.now() - app.revealStartTime;
        app.updateMusicPlayback(elapsed, app.revealTimeline.duration);
        if (app.revealTimeline.isComplete(elapsed)) {
            /* Animation finished — show full wall. */
            app.wall.clearReveal();
            app.stopRevealPlayback(true);
            return;
        }
        app.wall.setPlaybackFrame(app.revealTimeline.getFrame(elapsed));
        app.revealRAF = requestAnimationFrame(app.runRevealFrame);
    };

    app.stopRevealPlayback = function (saveHistory) {
        app.stopAllPlayback(saveHistory);
    };

    app.restartPlayback = function () {
        app.stopAllPlayback(true);
        app.startPlayback();
    };

    /* ---- Shuffle mode, driven by the same Timeline used for export ---- */

    app.startFlowPlayback = function () {
        if (app.photos.length < 2 || app.wall.layout.length < 2) {
            app.toast('至少需要两个素材才能流动播放');
            return;
        }
        app.setPositionMode(false);
        app.stopAllPlayback(false);
        app.flowSnapshot = app.captureState();
        app.flowCycleCount = 0;
        app.revealTimeline = app.playbackController.createTimeline('shuffle', { cycles: app.getPlaybackCycles() });
        app.startPlaybackBitmapPreload(app.wall.layout, app.revealTimeline.orderedIndices);
        app.revealStartTime = performance.now();
        app.flowPlaying = true;
        app.updateFlowControls();
        app.startMusicPlayback(0, false);
        app.runFlowTimelineFrame();
    };

    app.runFlowTimelineFrame = function () {
        if (!app.flowPlaying || !app.revealTimeline || app.revealTimeline.mode !== 'shuffle') return;
        var elapsed = performance.now() - app.revealStartTime;
        app.updateMusicPlayback(elapsed, 0);
        if (app.revealTimeline.isComplete(elapsed)) {
            var finalFrame = app.revealTimeline.getFrame(app.revealTimeline.duration);
            app.wall.clearPlayback();
            app.wall.setArrangement(finalFrame.photoIndices);
            app.wall.layoutSeed += 1;
            app.flowCycleCount += app.revealTimeline.cycles;
            app.revealTimeline = app.playbackController.createTimeline('shuffle', { cycles: app.getPlaybackCycles() });
            app.revealStartTime = performance.now();
            app.startPlaybackBitmapPreload(app.wall.layout, app.revealTimeline.orderedIndices);
        }
        app.wall.setPlaybackFrame(app.revealTimeline.getFrame(performance.now() - app.revealStartTime));
        app.revealRAF = requestAnimationFrame(app.runFlowTimelineFrame);
    };

    app.stopFlowPlayback = function (saveHistory) {
        app.stopAllPlayback(saveHistory);
    };

    app.updateFlowControls = function () {
        var button = document.getElementById('flow-play-btn');
        if (!button) return;
        button.classList.toggle('active', app.flowPlaying);
        button.setAttribute('aria-pressed', String(app.flowPlaying));
        document.getElementById('flow-play-icon').textContent = app.flowPlaying ? '■' : '▶';
        document.getElementById('flow-play-label').textContent = app.flowPlaying ?
            (app.playbackMode === 'shuffle' ? '停止轮播' : '停止播放') :
            (app.playbackMode === 'shuffle' ? '素材轮播' : '逐张播放');
    };

    app.updateActionState = function () {
        var hasPhotos = app.photos.length > 0;
        if (app.flowPlaying && app.photos.length < 2) app.stopAllPlayback(false);
        var exportButton = document.getElementById('export-btn');
        var shuffleButton = document.getElementById('shuffle-btn');
        var undoButton = document.getElementById('undo-btn');
        var redoButton = document.getElementById('redo-btn');
        var positionButton = document.getElementById('position-mode-btn');
        var flowButton = document.getElementById('flow-play-btn');
        var flowSpeed = document.getElementById('flow-speed');
        var playbackModeSelect = document.getElementById('playback-mode');
        var playbackOrderSelect = document.getElementById('playback-order');
        var playbackTransitionSelect = document.getElementById('playback-transition');
        if (exportButton) exportButton.disabled = !hasPhotos;
        if (shuffleButton) shuffleButton.disabled = !hasPhotos;
        if (undoButton) undoButton.disabled = !app.history || !app.history.canUndo();
        if (redoButton) redoButton.disabled = !app.history || !app.history.canRedo();
        if (positionButton) positionButton.disabled = !hasPhotos;
        if (flowButton) flowButton.disabled = !hasPhotos;
        if (flowSpeed) flowSpeed.disabled = app.photos.length < 2;
        if (playbackModeSelect) playbackModeSelect.disabled = !hasPhotos;
        if (playbackTransitionSelect) playbackTransitionSelect.disabled = !hasPhotos;
        if (playbackOrderSelect) {
            playbackOrderSelect.disabled = !hasPhotos;
            var orderLabel = playbackOrderSelect.closest('.flow-speed-field');
            if (orderLabel) orderLabel.style.display = hasPhotos ? '' : 'none';
        }
        if (playbackModeSelect) {
            var modeLabel = playbackModeSelect.closest('.flow-speed-field');
            if (modeLabel) modeLabel.style.display = app.photos.length >= 2 ? '' : 'none';
        }
        var saveProjectButton = document.getElementById('save-project-btn');
        if (saveProjectButton) saveProjectButton.disabled = !hasPhotos;
    };

    /* ------------------------------------------------------------------ *
     *  Empty state / loading
     * ------------------------------------------------------------------ */

    app.hideEmptyState = function () {
        var el = document.getElementById('empty-state');
        if (el) el.style.display = 'none';
        document.querySelector('.main-area').classList.add('has-photos');
    };

    app.showEmptyState = function () {
        var el = document.getElementById('empty-state');
        if (el) el.style.display = 'flex';
        document.querySelector('.main-area').classList.remove('has-photos');
    };

    app.showLoading = function (on, text) {
        var el = document.getElementById('loading-overlay');
        el.classList.toggle('active', on);
        if (on) document.getElementById('loading-text').textContent = text || '正在处理照片…';
    };

    /* ------------------------------------------------------------------ *
     *  Single photo editor
     * ------------------------------------------------------------------ */

    app.openPhotoEditor = function (index) {
        var photo = app.photos[index];
        if (!photo) return;
        app.stopAllPlayback(true);
        app.photoEditorIndex = index;
        app.photoEditorDraft = normalizePhotoTransform(photo);
        app.photoEditorReplacement = null;
        app.photoEditorReturnFocus = document.activeElement;
        document.getElementById('photo-editor-name').textContent = photo.name || '未命名照片';
        app.syncPhotoEditorControls();
        var editor = document.getElementById('photo-editor');
        document.querySelector('.app').inert = true;
        editor.classList.add('active');
        editor.setAttribute('aria-hidden', 'false');
        app.renderPhotoEditorPreview();
        setTimeout(function () { document.getElementById('photo-edit-zoom').focus(); }, 0);
    };

    app.activePhotoEditorPhoto = function () {
        return app.photoEditorReplacement || app.photos[app.photoEditorIndex] || null;
    };

    app.syncPhotoEditorControls = function () {
        var draft = app.photoEditorDraft;
        if (!draft) return;
        document.getElementById('photo-edit-zoom').value = draft.zoom;
        document.getElementById('photo-edit-focus-x').value = draft.focusX;
        document.getElementById('photo-edit-focus-y').value = draft.focusY;
        document.getElementById('photo-edit-rotation').value = draft.rotation;
        document.getElementById('photo-edit-zoom-value').textContent = Math.round(draft.zoom * 100) + '%';
        document.getElementById('photo-edit-focus-x-value').textContent = Math.round(draft.focusX * 100) + '%';
        document.getElementById('photo-edit-focus-y-value').textContent = Math.round(draft.focusY * 100) + '%';
        document.getElementById('photo-edit-rotation-value').textContent = Math.round(draft.rotation) + '°';
        document.getElementById('photo-edit-flip-x').setAttribute('aria-pressed', draft.flipX ? 'true' : 'false');
        document.getElementById('photo-edit-flip-y').setAttribute('aria-pressed', draft.flipY ? 'true' : 'false');
    };

    app.updatePhotoEditorDraft = function () {
        if (!app.photoEditorDraft) return;
        app.photoEditorDraft.zoom = parseFloat(document.getElementById('photo-edit-zoom').value);
        app.photoEditorDraft.focusX = parseFloat(document.getElementById('photo-edit-focus-x').value);
        app.photoEditorDraft.focusY = parseFloat(document.getElementById('photo-edit-focus-y').value);
        app.photoEditorDraft.rotation = parseFloat(document.getElementById('photo-edit-rotation').value);
        app.syncPhotoEditorControls();
        app.renderPhotoEditorPreview();
    };

    app.renderPhotoEditorPreview = function () {
        var photo = app.activePhotoEditorPhoto();
        if (!photo || !app.photoEditorDraft) return;
        var token = ++app.photoEditorRenderToken;
        app.assetManager.getBitmap(photo, 'original').then(function (bitmap) {
            if (token !== app.photoEditorRenderToken) return;
            var canvas = document.getElementById('photo-editor-canvas');
            var context = canvas.getContext('2d');
            context.clearRect(0, 0, canvas.width, canvas.height);
            var margin = 34;
            var width = canvas.width - margin * 2;
            var height = canvas.height - margin * 2;
            context.save();
            context.translate(canvas.width / 2, canvas.height / 2);
            context.fillStyle = '#09090e';
            context.fillRect(-width / 2, -height / 2, width, height);
            context.beginPath();
            addRoundedRectPath(context, -width / 2, -height / 2, width, height, 18);
            context.clip();
            var previewPhoto = Object.assign({}, photo);
            applyPhotoTransform(previewPhoto, app.photoEditorDraft);
            drawPhotoCover(context, bitmap, width, height, previewPhoto);
            context.restore();
            context.strokeStyle = 'rgba(157,143,255,.85)';
            context.lineWidth = 3;
            context.strokeRect(margin, margin, width, height);
        }).catch(function (error) {
            console.warn('照片精修预览失败:', error);
        });
    };

    app.replacePhotoEditorSource = function (file) {
        var maxSize = app.isVideoFile(file) ? app.maxVideoFileSize : app.maxFileSize;
        if (!file || file.size > maxSize) {
            app.toast('替换素材无效，或超过照片 40 MB / 视频 200 MB 限制');
            return;
        }
        app.showLoading(true, '正在准备替换素材…');
        app.loadPhoto(file, app.getPhotoImportDimension(app.photos.length)).then(function (photo) {
            if (app.photoEditorReplacement) app.assetManager.releasePhoto(app.photoEditorReplacement);
            app.photoEditorReplacement = photo;
            app.photoEditorDraft = normalizePhotoTransform(photo);
            document.getElementById('photo-editor-name').textContent = photo.name || '替换素材';
            app.syncPhotoEditorControls();
            app.renderPhotoEditorPreview();
            app.showLoading(false);
        }).catch(function (error) {
            console.error(error);
            app.showLoading(false);
            app.toast('替换素材读取失败');
        });
    };

    app.confirmPhotoEditor = function () {
        var current = app.photos[app.photoEditorIndex];
        var edited = app.activePhotoEditorPhoto();
        if (!current || !edited || !app.photoEditorDraft) return;
        app.recordHistory();
        applyPhotoTransform(edited, app.photoEditorDraft);
        if (app.photoEditorReplacement) {
            edited.featured = current.featured === true;
            app.assetManager.releasePhoto(current);
            app.photos[app.photoEditorIndex] = edited;
            app.photoEditorReplacement = null;
            app.wall.setPhotos(app.photos);
        } else {
            app.wall.refreshPhotoRendering();
        }
        app.renderPhotoLibrary();
        app.closePhotoEditor(true);
        app.toast('照片调整已应用');
    };

    app.closePhotoEditor = function (keepReplacement) {
        var editor = document.getElementById('photo-editor');
        if (!editor.classList.contains('active')) return;
        if (!keepReplacement && app.photoEditorReplacement) app.assetManager.releasePhoto(app.photoEditorReplacement);
        app.photoEditorReplacement = null;
        app.photoEditorDraft = null;
        app.photoEditorIndex = -1;
        app.photoEditorRenderToken++;
        editor.classList.remove('active');
        editor.setAttribute('aria-hidden', 'true');
        document.querySelector('.app').inert = false;
        if (app.photoEditorReturnFocus && typeof app.photoEditorReturnFocus.focus === 'function') {
            app.photoEditorReturnFocus.focus();
        }
        app.photoEditorReturnFocus = null;
    };

    /* ------------------------------------------------------------------ *
     *  Lightbox
     * ------------------------------------------------------------------ */

    app.openLightbox = function (index) {
        app.stopAllPlayback(true);
        app.lightboxIndex = index;
        var lb = document.getElementById('lightbox');
        app.lightboxReturnFocus = document.activeElement === document.body ? document.getElementById('wall-canvas') : document.activeElement;
        app.updateLightboxImage();
        document.querySelector('.app').inert = true;
        lb.classList.add('active');
        lb.setAttribute('aria-hidden', 'false');
        document.getElementById('lightbox-close').focus();
    };

    app.closeLightbox = function () {
        var lightbox = document.getElementById('lightbox');
        lightbox.classList.remove('active');
        lightbox.setAttribute('aria-hidden', 'true');
        document.querySelector('.app').inert = false;
        if (app.lightboxReturnFocus && typeof app.lightboxReturnFocus.focus === 'function') app.lightboxReturnFocus.focus();
        app.lightboxReturnFocus = null;
        if (app.lightboxObjectURL) URL.revokeObjectURL(app.lightboxObjectURL);
        app.lightboxObjectURL = '';
        if (app.lightboxTranscodedURL) URL.revokeObjectURL(app.lightboxTranscodedURL);
        app.lightboxTranscodedURL = '';
        app.lightboxTranscodeToken++;
        var img = document.getElementById('lightbox-img');
        var video = document.getElementById('lightbox-video');
        document.getElementById('lightbox-system-player').hidden = true;
        document.getElementById('lightbox-browser-play').hidden = true;
        img.removeAttribute('src');
        video.pause();
        video.onerror = null;
        video.onloadeddata = null;
        video.removeAttribute('src');
        video.load();
        app.lightboxIndex = -1;
    };

    app.navigateLightbox = function (dir) {
        if (app.lightboxIndex < 0) return;
        var n = app.photos.length;
        if (!n) return;
        app.lightboxIndex = (app.lightboxIndex + dir + n) % n;
        app.updateLightboxImage();
    };

    app.updateLightboxImage = function () {
        var photo = app.photos[app.lightboxIndex];
        if (!photo) return;
        var img = document.getElementById('lightbox-img');
        var video = document.getElementById('lightbox-video');
        var systemPlayer = document.getElementById('lightbox-system-player');
        var browserPlayer = document.getElementById('lightbox-browser-play');
        systemPlayer.hidden = true;
        browserPlayer.hidden = true;
        browserPlayer.disabled = false;
        browserPlayer.textContent = isAndroidNativeApp() ? '转码后播放' : '浏览器转码播放';
        systemPlayer.textContent = isNativeApp() ? '使用系统播放器' : '下载原视频';
        if (app.lightboxObjectURL) URL.revokeObjectURL(app.lightboxObjectURL);
        if (app.lightboxTranscodedURL) URL.revokeObjectURL(app.lightboxTranscodedURL);
        app.lightboxTranscodedURL = '';
        app.lightboxTranscodeToken++;
        var previewBlob = photo.playbackBlob || photo.originalBlob || photo.workingBlob || photo.blob;
        app.lightboxObjectURL = URL.createObjectURL(previewBlob);
        img.removeAttribute('src');
        video.pause();
        video.onerror = null;
        video.onloadeddata = null;
        video.removeAttribute('src');
        video.load();
        if (photo.mediaType === 'video') {
            img.hidden = true;
            video.hidden = false;
            video.src = app.lightboxObjectURL;
            video.poster = photo.workingSrc || photo.thumbnailSrc || '';
            if (photo.posterFallback && !photo.playbackBlob) {
                browserPlayer.hidden = false;
                systemPlayer.hidden = false;
            }
        } else {
            video.hidden = true;
            img.hidden = false;
            video.removeAttribute('poster');
            img.src = app.lightboxObjectURL;
        }
        var info = document.getElementById('lightbox-info');
        document.getElementById('lightbox-edit').textContent = photo.mediaType === 'video' ? '调整视频封面' : '裁切与精修';
        var seconds = Math.max(0, Math.round(photo.duration || 0));
        var duration = photo.mediaType === 'video' && seconds ?
            ' · ' + Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0') : '';
        var dimensions = photo.posterFallback ? '尺寸待设备解码' :
            (photo.originalWidth || photo.workingWidth || '—') + '×' +
            (photo.originalHeight || photo.workingHeight || '—');
        info.textContent = photo.name + '  ·  ' + dimensions + duration;
        if (photo.mediaType === 'video') {
            video.onloadeddata = function () {
                if (!photo.posterFallback) {
                    browserPlayer.hidden = true;
                    systemPlayer.hidden = true;
                }
            };
            video.onerror = function () {
                if (app.photos[app.lightboxIndex] === photo) {
                    info.textContent = photo.name + ' · 当前设备不支持此视频编码，可转码后在应用内播放';
                    browserPlayer.hidden = false;
                    systemPlayer.hidden = false;
                }
            };
        }
    };

    app.playLightboxVideoInBrowser = function () {
        var photo = app.photos[app.lightboxIndex];
        var source = photo && (photo.originalBlob || photo.workingBlob || photo.blob);
        if (!photo || photo.mediaType !== 'video' || !(source instanceof Blob)) return;
        var button = document.getElementById('lightbox-browser-play');
        var info = document.getElementById('lightbox-info');
        var video = document.getElementById('lightbox-video');
        var token = ++app.lightboxTranscodeToken;
        button.disabled = true;
        button.textContent = isAndroidNativeApp() ? '正在使用设备解码器…' : '正在加载视频引擎…';
        var enginePromise = isAndroidNativeApp() ?
            Promise.resolve().then(function () {
                /* ffmpeg.wasm regularly OOMs on Android WebView, so prefer the
                   hardware-accelerated Media3 pipeline and fall back to the
                   wasm engine only when the device encoder refuses the file. */
                return transcodeVideoForAndroidPlayback(source, {
                    name: photo.name,
                    onStatus: function (status) {
                        if (token !== app.lightboxTranscodeToken) return;
                        button.textContent = status.message || '正在设备转码…';
                        info.textContent = photo.name + ' · 转码仅在当前设备内完成，原文件保持不变';
                    }
                }).catch(function (nativeError) {
                    console.warn('Android 设备转码失败，回退到浏览器引擎:', nativeError);
                    button.textContent = '设备转码不可用，正在使用本地兼容引擎…';
                    return import('./video/BrowserVideoTranscoder.js').then(function (browser) {
                        return browser.transcodeVideoForBrowser(source, {
                            name: photo.name,
                            onStatus: function (status) {
                                if (token !== app.lightboxTranscodeToken) return;
                                button.textContent = status.message || '正在本地转码…';
                            }
                        });
                    });
                });
            }) :
            import('./video/BrowserVideoTranscoder.js').then(function (module) {
                return module.transcodeVideoForBrowser(source, {
                    name: photo.name,
                    onStatus: function (status) {
                        if (token !== app.lightboxTranscodeToken) return;
                        button.textContent = status.message || '正在本地转码…';
                        info.textContent = photo.name + ' · 转码仅在当前设备内完成，原文件保持不变';
                    }
                });
            });
        enginePromise.then(function (playableBlob) {
            if (token !== app.lightboxTranscodeToken || app.photos[app.lightboxIndex] !== photo) return;
            /* Reuse the temporary H.264 copy in wall cells as well as in the
               lightbox. The original remains the project/export source. */
            photo.playbackBlob = playableBlob;
            if (app.videoPlayer) {
                app.videoPlayer.retry(photo);
                app.videoPlayer.sync(app.photos);
            }
            if (app.lightboxTranscodedURL) URL.revokeObjectURL(app.lightboxTranscodedURL);
            app.lightboxTranscodedURL = URL.createObjectURL(playableBlob);
            video.onerror = function () {
                if (token === app.lightboxTranscodeToken) app.toast('转码后仍无法播放，请使用系统播放器');
            };
            video.src = app.lightboxTranscodedURL;
            video.load();
            return video.play().then(function () { return true; }).catch(function () { return false; });
        }).then(function (started) {
            if (token !== app.lightboxTranscodeToken || !app.lightboxTranscodedURL) return;
            button.hidden = true;
            info.textContent = photo.name + (started ?
                ' · 正在播放本地转码副本，原文件保持不变' :
                ' · 转码完成，请点击视频播放；原文件保持不变');
        }).catch(function (error) {
            if (token !== app.lightboxTranscodeToken) return;
            console.error('浏览器视频转码失败:', error);
            button.disabled = false;
            button.textContent = '重试转码播放';
            info.textContent = photo.name + ' · ' + (error && error.message ? error.message : '本地转码失败');
            document.getElementById('lightbox-system-player').hidden = false;
        });
    };

    /* ------------------------------------------------------------------ *
     *  Export
     * ------------------------------------------------------------------ */

    app.updateExportDialogCopy = function () {
        var category = app.getCheckedValue('export-category', 'image');
        var title = document.getElementById('export-title');
        var subtitle = title && title.parentElement ? title.parentElement.querySelector('p') : null;
        if (title) title.textContent = category === 'video' ? '导出视频' :
            category === 'pdf' ? '导出 PDF' : '导出图片';
        if (subtitle) subtitle.textContent = category === 'video' ?
            (isAndroidNativeApp() ?
                'Android 使用 MediaCodec 导出 H.264 MP4，可选择尺寸、顺序与转场' :
                '选择视频尺寸、比例、播放顺序与转场后保存为 MP4 / WebM') :
            category === 'pdf' ? '选择纸张、DPI、出血和裁切标记' :
            '选择适合分享或打印的输出设置';
    };

    app.openExportDialog = function () {
        if (app.wall.layout.length === 0) {
            app.toast('请先上传照片');
            return;
        }
        app.stopAllPlayback(true);
        var dialog = document.getElementById('export-dialog');
        app.exportReturnFocus = document.activeElement;
        document.querySelector('.app').inert = true;
        dialog.classList.add('active');
        dialog.setAttribute('aria-hidden', 'false');
        app.syncExportCategoryFields();
        app.updateExportDialogCopy();
        app.updateExportOptions();
        setTimeout(function () {
            var nameInput = document.getElementById('export-name');
            nameInput.focus();
            nameInput.select();
        }, 0);
    };

    app.closeExportDialog = function () {
        var dialog = document.getElementById('export-dialog');
        dialog.classList.remove('active');
        dialog.setAttribute('aria-hidden', 'true');
        document.querySelector('.app').inert = false;
        if (app.exportPreviewRAF) cancelAnimationFrame(app.exportPreviewRAF);
        app.exportPreviewRAF = null;
        if (app.exportReturnFocus && typeof app.exportReturnFocus.focus === 'function') app.exportReturnFocus.focus();
        app.exportReturnFocus = null;
    };

    app.trapDialogFocus = function (event, dialog) {
        if (!dialog) return;
        var focusable = Array.prototype.slice.call(dialog.querySelectorAll(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )).filter(function (element) { return element.offsetParent !== null; });
        if (!focusable.length) return;
        var first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    };

    app.getCheckedValue = function (name, fallback) {
        var selected = document.querySelector('input[name="' + name + '"]:checked');
        return selected ? selected.value : fallback;
    };

    app.syncExportCategoryFields = function () {
        var format = app.getCheckedValue('export-format', 'png');
        var category;
        if (format === 'pdf') category = 'pdf';
        else if (format === 'webm' || format === 'mp4') category = 'video';
        else category = 'image';
        document.getElementById('image-format-field').hidden = category !== 'image';
        document.getElementById('video-format-field').hidden = category !== 'video';
        var catRadio = document.querySelector('input[name="export-category"][value="' + category + '"]');
        if (catRadio) catRadio.checked = true;
    };

    app.onExportCategoryChange = function () {
        var category = app.getCheckedValue('export-category', 'image');
        document.getElementById('image-format-field').hidden = category !== 'image';
        document.getElementById('video-format-field').hidden = category !== 'video';
        /* Ensure the correct format radio is selected within each category. */
        if (category === 'pdf') {
            /* PDF has no sub-format; set a hidden value so updateExportOptions works. */
            var pdfRadio = document.querySelector('input[name="export-format"][value="pdf"]');
            if (pdfRadio) pdfRadio.checked = true;
        } else if (category === 'video') {
            var mp4Radio = document.querySelector('input[name="export-format"][value="mp4"]');
            if (mp4Radio) mp4Radio.checked = true;
        } else {
            var pngRadio = document.querySelector('input[name="export-format"][value="png"]');
            if (pngRadio) pngRadio.checked = true;
        }
        app.updateExportDialogCopy();
        app.updateExportOptions();
    };

    app.updateExportOptions = function () {
        var format = app.getCheckedValue('export-format', 'png');
        if (isAndroidNativeApp()) {
            var webmRadio = document.querySelector('input[name="export-format"][value="webm"]');
            var mp4Radio = document.querySelector('input[name="export-format"][value="mp4"]');
            if (webmRadio) {
                webmRadio.disabled = true;
                var webmOption = webmRadio.closest('label');
                if (webmOption) webmOption.hidden = true;
            }
            if (format === 'webm') {
                if (mp4Radio) mp4Radio.checked = true;
                format = 'mp4';
            }
        }
        var transparentRadio = document.querySelector('input[name="export-background"][value="transparent"]');
        var transparentOption = document.getElementById('transparent-background-option');
        var isVideo = format === 'webm' || format === 'mp4';
        var disabled = format === 'jpeg' || isVideo;
        transparentRadio.disabled = disabled;
        transparentOption.classList.toggle('disabled', disabled);
        if (disabled && transparentRadio.checked) {
            document.querySelector('input[name="export-background"][value="#ffffff"]').checked = true;
        }
        document.getElementById('print-export-field').hidden = format !== 'pdf';
        document.getElementById('video-export-field').hidden = !isVideo;
        /* Hide scale and background options for video export. */
        var scaleField = document.getElementById('export-scale-field');
        var bgField = document.getElementById('export-background-field');
        if (scaleField) scaleField.hidden = isVideo;
        if (bgField) bgField.hidden = isVideo;
        app.updateExportDimensions();
        app.scheduleExportPreview();
    };

    app.updateExportDimensions = function () {
        var target = document.getElementById('export-dimensions');
        if (!target || !app.wall || !app.wall.cssWidth) return;
        var format = app.getCheckedValue('export-format', 'png');
        var isVideo = format === 'webm' || format === 'mp4';
        var scale = parseInt(app.getCheckedValue('export-scale', '2'), 10);
        var aspectRatio = app.getCheckedValue('export-aspect', 'auto');
        if (format === 'pdf') {
            var preset = getPrintPreset(document.getElementById('export-print-size').value);
            var dpi = parseInt(document.getElementById('export-print-dpi').value, 10);
            var bleed = document.getElementById('export-print-bleed').checked ? 3 : 0;
            var printDimensions = printPixelDimensions(preset, dpi, bleed);
            var assessment = assessPrintResolution(printDimensions.width, printDimensions.height, {
                widthMm: preset.widthMm + bleed * 2,
                heightMm: preset.heightMm + bleed * 2
            });
            target.textContent = preset.name + ' · ' + printDimensions.width + ' × ' + printDimensions.height + ' px';
            document.getElementById('export-print-quality').textContent = assessment.dpi + ' DPI · ' + assessment.label;
            return;
        }
        var dimensions = app.wall.getExportDimensions(isVideo ? 1 : scale, aspectRatio);
        if (isVideo) {
            dimensions = resolveVideoExportDimensions(document.getElementById('export-video-preset').value, {
                width: dimensions.width, height: dimensions.height, aspectRatio: aspectRatio
            });
        }
        var width = dimensions.width;
        var height = dimensions.height;
        if (isVideo) {
            var previewTimeline = app.playbackController.createTimeline(app.playbackMode, {
                cycles: app.playbackMode === 'shuffle' ? app.getPlaybackCycles() : 1
            });
            var durationSec = previewTimeline.duration / 1000;
            var fps = Math.max(10, Math.min(30, Number(dimensions.fps) || 30));
            var totalFrames = Math.ceil(durationSec * fps) + 1;
            target.textContent = width + ' × ' + height + ' · ' + fps + 'fps · ' + durationSec.toFixed(1) + 's · ' + totalFrames + ' 帧';
        } else {
            var megapixels = (width * height / 1000000).toFixed(1);
            target.textContent = width + ' × ' + height + ' px · ' + megapixels + ' MP';
        }
    };

    app.getExportBackground = function () {
        var background = app.getCheckedValue('export-background', '#ffffff');
        if (background === 'custom') background = document.getElementById('export-background-color').value;
        if (app.getCheckedValue('export-format', 'png') === 'jpeg' && background === 'transparent') background = '#ffffff';
        return background;
    };

    app.scheduleExportPreview = function () {
        if (!document.getElementById('export-dialog').classList.contains('active')) return;
        if (app.exportPreviewRAF) cancelAnimationFrame(app.exportPreviewRAF);
        app.exportPreviewRAF = requestAnimationFrame(function () {
            app.exportPreviewRAF = null;
            app.renderExportPreview();
        });
    };

    app.renderExportPreview = function () {
        if (!app.wall || !app.wall.layout.length) return;
        var aspectRatio = app.getCheckedValue('export-aspect', 'auto');
        var background = app.getExportBackground();
        var isPdf = app.getCheckedValue('export-format', 'png') === 'pdf';
        var printPreset = isPdf ? getPrintPreset(document.getElementById('export-print-size').value) : null;
        var targetAspect = printPreset ? printPreset.widthMm / printPreset.heightMm : null;
        var dimensions = targetAspect ? { width: targetAspect * 720, height: 720 } : app.wall.getExportDimensions(1, aspectRatio);
        var previewScale = Math.min(1, 720 / Math.max(dimensions.width, dimensions.height));
        var source = app.wall.createExportCanvas({
            scale: previewScale,
            background: background,
            aspectRatio: aspectRatio,
            targetAspect: targetAspect
        });
        var preview = document.getElementById('export-preview-canvas');
        preview.width = source.width;
        preview.height = source.height;
        var context = preview.getContext('2d');
        context.clearRect(0, 0, preview.width, preview.height);
        context.drawImage(source, 0, 0);
        document.getElementById('export-preview-ratio').textContent = printPreset ? printPreset.name : ({
            auto: '紧贴轮廓',
            '3:4': '3:4 竖版（轮廓外扩）',
            '4:3': '4:3 横版（轮廓外扩）',
            '9:16': '9:16 竖版（轮廓外扩）',
            '16:9': '16:9 横版（轮廓外扩）'
        }[aspectRatio] || aspectRatio);
    };

    app.exportImage = function () {
        if (app.wall.layout.length === 0) {
            app.toast('请先上传照片');
            return;
        }
        try {
            var format = app.getCheckedValue('export-format', 'png');
            if (isAndroidNativeApp() && format === 'webm') {
                format = 'mp4';
                app.toast('Android 应用使用原生 H.264/MP4 导出');
            }
            var scale = parseInt(app.getCheckedValue('export-scale', '2'), 10);
            var aspectRatio = app.getCheckedValue('export-aspect', 'auto');
            var background = app.getExportBackground();

            if ((format === 'webm' || format === 'mp4') && app.playbackOrder === 'custom' && !app.customOrigin) {
                app.toast('请先关闭导出窗口，并在照片墙上点击播放起点');
                return;
            }

            var rawName = document.getElementById('export-name').value.trim() || '我的照片墙';
            var fileName = rawName.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').replace(/[. ]+$/, '') || '我的照片墙';
            app.closeExportDialog();
            var exportingVideo = format === 'webm' || format === 'mp4';
            app.showLoading(true, format === 'pdf' ? '正在生成印刷 PDF…' :
                exportingVideo ? '正在准备视频导出…' : '正在生成高清图片…');

            var outputPromise;
            var extension;
            var mime;
            if (format === 'webm' || format === 'mp4') {
                /* ---- Video export ---- */
                if (!isAndroidNativeApp() && !pickVideoMimeType(format)) {
                    app.showLoading(false);
                    app.toast('当前浏览器不支持视频录制');
                    return;
                }
                var selectedVideoAspect = app.getCheckedValue('export-aspect', 'auto');
                var sourceVideoDims = app.wall.getExportDimensions(1, selectedVideoAspect);
                var videoDims = resolveVideoExportDimensions(document.getElementById('export-video-preset').value, {
                    width: sourceVideoDims.width, height: sourceVideoDims.height, aspectRatio: selectedVideoAspect
                });
                var videoAspect = videoDims.aspectRatio;
                /* Cap video resolution for performance, bounded by the device
                   profile so low-memory phones record at a smaller canvas. */
                var maxVideoPixels = Math.min(1280 * 720 * 4, app.deviceProfile.maxExportPixels);
                var videoScale = 1;
                while (videoDims.width * videoDims.height * videoScale * videoScale > maxVideoPixels && videoScale > 0.5) {
                    videoScale -= 0.1;
                }
                videoScale = Math.round(videoScale * 10) / 10;
                var videoTimeline = app.playbackController.createTimeline(app.playbackMode, {
                    cycles: app.playbackMode === 'shuffle' ? app.getPlaybackCycles() : 1
                });
                /* Video export renders every frame synchronously; warm the
                   bitmap cache by render order so LRU-evicted photos don't
                   drop out as blank cells mid-recording. */
                app.startPlaybackBitmapPreload(app.wall.layout, videoTimeline.orderedIndices);
                extension = format;
                mime = format === 'mp4' ? 'video/mp4' : 'video/webm';
                outputPromise = recordTimelineCanvas(app.wall, videoTimeline, {
                    width: videoDims.width,
                    height: videoDims.height,
                    fps: isAndroidNativeApp() ? Math.min(15, videoDims.fps) : videoDims.fps,
                    format: format,
                    scale: videoScale,
                    aspectRatio: videoAspect,
                    background: background,
                    backgroundMusic: app.backgroundMusic,
                    onStatus: function (msg) {
                        app.showLoading(true, msg);
                    },
                    onProgress: function (frame, total) {
                        var pct = Math.round(frame / total * 100);
                        app.showLoading(true, '正在渲染视频… ' + pct + '% (' + frame + '/' + total + ' 帧)');
                    }
                });
            } else if (format === 'pdf') {
                var preset = getPrintPreset(document.getElementById('export-print-size').value);
                var dpi = parseInt(document.getElementById('export-print-dpi').value, 10);
                var bleedMm = document.getElementById('export-print-bleed').checked ? 3 : 0;
                var printDimensions = printPixelDimensions(preset, dpi, bleedMm);
                if (printDimensions.width * printDimensions.height > app.deviceProfile.maxExportPixels && dpi > 150) {
                    dpi = 150;
                    printDimensions = printPixelDimensions(preset, dpi, bleedMm);
                    app.toast('为避免设备内存不足，打印精度已调整为 150 DPI');
                }
                outputPromise = app.wall.createExportCanvasAsync({
                    targetWidth: printDimensions.width,
                    targetHeight: printDimensions.height,
                    background: background === 'transparent' ? '#ffffff' : background,
                    useOriginal: true
                }).then(function (canvas) {
                    return createPrintPdf(canvas, {
                        preset: preset,
                        bleedMm: bleedMm,
                        cropMarks: bleedMm > 0,
                        title: fileName
                    });
                });
                extension = 'pdf';
                mime = 'application/pdf';
            } else {
                var requestedScale = scale;
                while (scale > 1) {
                    var candidateDimensions = app.wall.getExportDimensions(scale, aspectRatio);
                    if (candidateDimensions.width * candidateDimensions.height <= app.deviceProfile.maxExportPixels) break;
                    scale--;
                }
                if (scale !== requestedScale) app.toast('为避免设备内存不足，已将导出清晰度调整为 ' + scale + '×');
                mime = format === 'jpeg' ? 'image/jpeg' : 'image/' + format;
                extension = format === 'jpeg' ? 'jpg' : format;
                outputPromise = app.wall.createExportCanvasAsync({
                    scale: scale,
                    background: background,
                    aspectRatio: aspectRatio,
                    useOriginal: true
                }).then(function (canvas) { return app.canvasToBlob(canvas, mime, 0.94); });
            }

            outputPromise.then(function (blob) {
                return saveBlob(blob, {
                    title: format === 'pdf' ? '导出照片墙 PDF' :
                        (format === 'webm' || format === 'mp4') ? '导出照片墙视频' :
                            '导出照片墙图片',
                    fileName: fileName + '.' + extension,
                    filters: [{ name: extension.toUpperCase() + (mime === 'application/pdf' ? ' 文档' : mime.startsWith('video/') ? ' 视频' : ' 图片'), extensions: [extension] }]
                }).then(function (result) {
                    app.showLoading(false);
                    if (result.cancelled) app.toast('已取消导出');
                    else {
                        var typeLabel = format === 'pdf' ? 'PDF' : mime.startsWith('video/') ? '视频' : '图片';
                        var sizeLabel = blob.size > 1048576 ? (blob.size / 1048576).toFixed(1) + ' MB' : Math.round(blob.size / 1024) + ' KB';
                        app.toast(typeLabel + '已导出 · ' + sizeLabel);
                    }
                });
            }).catch(function (error) {
                app.showLoading(false);
                var message = error && error.message ? String(error.message) : '';
                app.toast(message ? '导出失败：' + message.slice(0, 80) :
                    '导出失败，请降低规格后重试');
                console.error(error);
            });
        } catch (err) {
            app.showLoading(false);
            app.toast('导出失败');
            console.error(err);
        }
    };

    app.canvasToBlob = function (canvas, mime, quality) {
        return new Promise(function (resolve, reject) {
            canvas.toBlob(function (blob) {
                if (blob) resolve(blob);
                else reject(new Error('Canvas encode failed'));
            }, mime, quality);
        });
    };

    /* ------------------------------------------------------------------ *
     *  Toast
     * ------------------------------------------------------------------ */

    var toastTimer = null;
    app.toast = function (msg) {
        var el = document.getElementById('toast');
        el.textContent = msg;
        el.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () {
            el.classList.remove('show');
        }, 2200);
    };

    // Boot
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', app.init);
    } else {
        app.init();
    }
