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
import { applyPhotoTransform, drawPhotoCover, normalizePhotoTransform } from './image/PhotoTransform.js';
import { createOverlay, normalizeOverlays } from './overlay/OverlayRenderer.js';
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
import { isNativeApp, openBlobWithSystem, saveBlob } from './platform/NativeFileService.js';
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
        flowPlaying: false,
        flowTimer: null,
        flowSnapshot: null,
        flowCycleCount: 0,
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
        photoObjectURLs: new Set(),
        photoObjectURLCleanupTimer: null,
        maxPhotos: 1000,
        maxFileSize: 40 * 1024 * 1024,
        maxVideoFileSize: 200 * 1024 * 1024,
        maxPhotoDimension: 1600,
        photoLoadConcurrency: 3,
        photoLoadTimeout: 30000,
        supportedImageTypes: ['image/jpeg', 'image/png', 'image/webp'],
        supportedVideoTypes: ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v']
    };

    /* ------------------------------------------------------------------ *
     *  Init
     * ------------------------------------------------------------------ */

    app.init = function () {
        app.detachCrashCapture = installCrashCapture();
        var canvas = document.getElementById('wall-canvas');
        app.deviceProfile = createDeviceProfile({
            viewportWidth: window.innerWidth,
            coarsePointer: window.matchMedia('(pointer: coarse)').matches,
            deviceMemory: navigator.deviceMemory,
            hardwareConcurrency: navigator.hardwareConcurrency
        });
        app.photoLoadConcurrency = app.deviceProfile.photoLoadConcurrency;
        app.maxPhotoDimension = app.deviceProfile.maxPhotoDimension;
        app.assetManager = createPhotoAssetManager({
            thumbnailDimension: app.deviceProfile.thumbnailDimension,
            maxWorkingEntries: app.deviceProfile.maxWorkingBitmaps,
            maxWorkingPixels: app.deviceProfile.maxWorkingBitmapPixels,
            maxOriginalEntries: app.deviceProfile.maxOriginalBitmaps,
            maxOriginalPixels: app.deviceProfile.maxOriginalBitmapPixels
        });
        app.templateLibrary = createTemplateLibrary();
        app.wall = new PhotoWall(canvas, {
            maxDevicePixelRatio: app.deviceProfile.maxEditorDpr,
            assetManager: app.assetManager
        });
        document.documentElement.classList.toggle('native-app', isNativeApp());
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
                app.scheduleObjectURLCleanup();
            }
        });
        app.autosave = createProjectAutosave({
            delay: app.deviceProfile.mobile ? 2500 : 1500,
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
        app.wall.onBeforeLocalAdjust = function () {
            app.localAdjustSnapshot = app.captureState();
        };
        app.wall.onLocalAdjust = function () {
            if (app.localAdjustSnapshot) app.recordHistory(app.localAdjustSnapshot);
            app.localAdjustSnapshot = null;
            app.toast('已调整照片在当前格位中的位置');
            app.updateActionState();
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
        requestAnimationFrame(function () {
            app.wall.resize();
        });

        app.bindUI();
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
                app.wall.resize();
            }, 200);
        });
        window.addEventListener('beforeunload', function () {
            app.stopFlowPlayback(false);
            if (app.autosave) app.autosave.saveNow();
            if (app.photoAnalyzerWorker) app.photoAnalyzerWorker.terminate();
            if (app.assetManager) app.assetManager.destroy();
            if (app.detachCrashCapture) app.detachCrashCapture();
            clearTimeout(app.photoObjectURLCleanupTimer);
            app.photoObjectURLs.forEach(function (url) { URL.revokeObjectURL(url); });
            app.photoObjectURLs.clear();
        });
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'hidden') {
                app.stopFlowPlayback(true);
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
     *  UI Binding
     * ------------------------------------------------------------------ */

    app.bindUI = function () {
        document.querySelector('.sidebar').addEventListener('pointerdown', function (event) {
            if (app.flowPlaying && event.target.closest('button, input, select, textarea')) app.stopFlowPlayback(true);
        });
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
            app.updateModeHint();
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
            app.stopFlowPlayback(true);
            app.recordHistory();
            var seed = app.wall.nextLayoutVariant();
            app.toast('已生成新方案 · #' + seed);
        });
        document.getElementById('position-mode-btn').addEventListener('click', function () {
            app.setPositionMode(app.wall.interactionMode !== 'adjust');
        });
        document.getElementById('flow-play-btn').addEventListener('click', function () {
            if (app.flowPlaying) app.stopFlowPlayback(true);
            else app.startFlowPlayback();
        });
        document.getElementById('flow-speed').addEventListener('change', function () {
            if (app.flowPlaying) app.scheduleNextFlowCycle();
        });
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
        ['export-print-size', 'export-print-dpi', 'export-print-bleed'].forEach(function (id) {
            document.getElementById(id).addEventListener('change', app.updateExportOptions);
        });
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
            var palette = preset.palette || ['#403b68', '#9d8cff'];
            var background = preset.thumbnail ? 'url(&quot;' + app.escapeHTML(preset.thumbnail) + '&quot;)' :
                'linear-gradient(135deg,' + palette[0] + ',' + palette[1] + ')';
            return '<div class="preset-card"><button class="preset-btn" type="button" data-preset="' + preset.id +
                '" aria-pressed="false" title="应用' + app.escapeHTML(preset.name) + '模板">' +
                '<span class="preset-thumb" aria-hidden="true" style="background-image:' + background + '"></span>' +
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
        app.updateModeHint();
        app.updateLayoutPresetSelection();
    };

    app.applyLayoutPreset = function (presetId) {
        var preset = app.findTemplate(presetId);
        if (!preset || layoutPresetMatches(app.wall, app.currentShapeKey, preset)) return;
        app.stopFlowPlayback(true);
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
        app.recordHistory();
        if (action === 'delete') {
            app.overlays.splice(index, 1);
            if (app.selectedOverlayId === id) app.selectedOverlayId = null;
        } else if (action === 'visibility') {
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
        return Boolean(file) && (app.supportedVideoTypes.indexOf(file.type) >= 0 || /\.(mp4|webm|mov|m4v)$/i.test(file.name || ''));
    };

    app.videoMimeForFile = function (file) {
        if (file && /^video\//i.test(file.type)) return file.type;
        var extension = ((file && file.name) || '').split('.').pop().toLowerCase();
        return { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/x-m4v' }[extension] || 'video/mp4';
    };

    app.handleFiles = function (files) {
        var incoming = Array.prototype.slice.call(files);
        var existingSignatures = new Set(app.photos.map(function (photo) { return photo.signature; }).filter(Boolean));
        var skippedLarge = 0, skippedDuplicate = 0;
        var mediaFiles = incoming.filter(function (file) {
            var video = app.isVideoFile(file);
            var supportedType = app.supportedImageTypes.indexOf(file.type) >= 0 || video;
            var supportedExtension = /\.(jpe?g|png|webp|mp4|webm|mov|m4v)$/i.test(file.name);
            if (!supportedType && !supportedExtension) return false;
            if (file.size > (video ? app.maxVideoFileSize : app.maxFileSize)) { skippedLarge++; return false; }
            var signature = [file.name, file.size, file.lastModified].join(':');
            if (existingSignatures.has(signature)) { skippedDuplicate++; return false; }
            existingSignatures.add(signature);
            return true;
        });
        var remaining = Math.max(0, app.maxPhotos - app.photos.length);
        var skippedLimit = Math.max(0, mediaFiles.length - remaining);
        mediaFiles = mediaFiles.slice(0, remaining);
        if (mediaFiles.length === 0) {
            if (!remaining) app.toast('最多支持 ' + app.maxPhotos + ' 个素材');
            else if (skippedDuplicate) app.toast('这些素材已经添加过了');
            else if (skippedLarge) app.toast('照片不能超过 40 MB，视频不能超过 200 MB');
            else app.toast('请选择 JPG、PNG、WebP、MP4、WebM 或 MOV 文件');
            return;
        }
        app.stopFlowPlayback(true);

        var total = mediaFiles.length;
        if (app.deviceProfile.mobile && app.photos.length + total > app.deviceProfile.recommendedPhotoCount) {
            app.toast('手机端建议不超过 ' + app.deviceProfile.recommendedPhotoCount + ' 个素材；编辑预览会降采样，原文件仍保留');
        }
        var importDimension = app.getPhotoImportDimension(app.photos.length + total);
        app.showLoading(true, '正在读取 0/' + total + ' 个素材…');
        app.loadPhotoBatch(mediaFiles, function (completed) {
            app.showLoading(true, '正在读取 ' + completed + '/' + total + ' 个素材…');
        }, importDimension).then(function (loadedPhotos) {
            var valid = loadedPhotos.filter(Boolean);
            if (valid.length) app.recordHistory();
            Array.prototype.push.apply(app.photos, valid);
            app.updatePhotoCount();
            app.renderPhotoLibrary();
            app.wall.setPhotos(app.photos);
            if (app.photos.length) app.hideEmptyState();
            app.showLoading(false);
            var skipped = skippedLarge + skippedDuplicate + skippedLimit + (total - valid.length);
            var fallbackVideos = valid.filter(function (photo) { return photo.posterFallback; }).length;
            app.toast('已添加 ' + valid.length + ' 个素材' + (skipped ? ' · 跳过 ' + skipped + ' 个' : '') +
                (fallbackVideos ? ' · ' + fallbackVideos + ' 个视频需使用设备解码播放' : ''));
        }).catch(function (err) {
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
                if (objectURL) {
                    app.photoObjectURLs.delete(objectURL);
                    URL.revokeObjectURL(objectURL);
                }
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
                app.analyzeLoadedPhoto(loadedImage, fileBlob).then(function (analysis) {
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
                        app.photoObjectURLs.delete(objectURL);
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
        if (!window.confirm('确定清空全部 ' + app.photos.length + ' 张照片吗？此操作可以撤销。')) return;
        app.stopFlowPlayback(true);
        app.recordHistory();
        app.photos.forEach(function (photo) { app.assetManager.releasePhoto(photo); });
        app.photos = [];
        app.updatePhotoCount();
        app.wall.setPhotos([]);
        app.renderPhotoLibrary();
        app.showEmptyState();
        app.toast('已清空照片');
    };

    app.updatePhotoCount = function () {
        document.getElementById('photo-count').textContent = app.photos.length;
        app.updateActionState();
    };

    app.renderPhotoLibrary = function () {
        if (app.photoLibrary) app.photoLibrary.render(app.photos);
    };

    app.scheduleObjectURLCleanup = function () {
        clearTimeout(app.photoObjectURLCleanupTimer);
        app.photoObjectURLCleanupTimer = setTimeout(function () {
            var retained = new Set();
            function retainPhotos(state) {
                if (!state || !Array.isArray(state.photos)) return;
                state.photos.forEach(function (photo) {
                    if (photo && typeof photo.src === 'string' && photo.src.startsWith('blob:')) retained.add(photo.src);
                });
            }
            retainPhotos({ photos: app.photos });
            if (app.history && typeof app.history.visitStates === 'function') app.history.visitStates(retainPhotos);
            app.photoObjectURLs.forEach(function (url) {
                if (retained.has(url)) return;
                URL.revokeObjectURL(url);
                app.photoObjectURLs.delete(url);
            });
            app.photoObjectURLCleanupTimer = null;
        }, 0);
    };

    app.reorderPhoto = function (fromIndex, targetIndex) {
        if (!app.photos[fromIndex] || !app.photos[targetIndex]) return;
        app.stopFlowPlayback(true);
        app.recordHistory();
        var moved = app.photos.splice(fromIndex, 1)[0];
        app.photos.splice(targetIndex, 0, moved);
        app.renderPhotoLibrary();
        app.wall.setPhotos(app.photos);
        app.toast('照片顺序已更新');
    };

    app.toggleFeaturedPhoto = function (index) {
        if (!app.photos[index]) return;
        app.stopFlowPlayback(true);
        app.recordHistory();
        app.photos[index].featured = !app.photos[index].featured;
        app.renderPhotoLibrary();
        app.wall.setPhotos(app.photos);
        app.toast(app.photos[index].featured ? '已设为重点照片，将优先显示为大图' : '已取消重点照片');
    };

    app.removePhoto = function (index) {
        if (!app.photos[index]) return;
        app.stopFlowPlayback(true);
        app.recordHistory();
        var removed = app.photos.splice(index, 1)[0];
        app.assetManager.releasePhoto(removed);
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
            return app.restoreProject(snapshot.project, {
                successMessage: '已从自动保存恢复 · ' + snapshot.project.photos.length + ' 张照片'
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
                photoShape: app.wall.photoShape,
                smartPlacement: app.wall.smartPlacement,
                mixedSizes: app.wall.mixedSizes,
                rotationRange: app.wall.rotationRange,
                layoutSeed: app.wall.layoutSeed
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
            return createProjectContainer(project, app.photos, { appVersion: '1.0.0' });
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
        app.stopFlowPlayback(true);
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

                function finish(callback, value, retainURL) {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timeout);
                    img.onload = null;
                    img.onerror = null;
                    if (retainURL) app.photoObjectURLs.add(objectURL);
                    else URL.revokeObjectURL(objectURL);
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
                        finish(resolve, photo, false);
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
        var totalPhotos = project.photos.length;
        app.showLoading(true, '正在恢复 0/' + totalPhotos + ' 张照片…');
        return Promise.all([
            app.loadProjectPhotoBatch(project.photos, function (completed) {
                app.showLoading(true, '正在恢复 ' + completed + '/' + totalPhotos + ' 张照片…');
            }),
            app.restoreProjectShape(project.shape)
        ]).then(function (results) {
            var photos = results[0];
            var shapeKey = results[1];
            var settings = project.settings || {};
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
                photoShape: ['circle', 'square', 'diamond', 'hexagon', 'heart'].indexOf(settings.photoShape) >= 0 ? settings.photoShape : 'square',
                smartPlacement: settings.smartPlacement !== false,
                mixedSizes: settings.mixedSizes !== false,
                rotationRange: Math.max(0, Math.min(24, Number(settings.rotationRange) || 0)),
                layoutSeed: Number(settings.layoutSeed) || 1,
                overlays: normalizeOverlays(project.overlays),
                arrangement: [],
                layout: project.layout
            });
            app.showLoading(false);
            app.toast(options.successMessage || '项目已恢复 · ' + photos.length + ' 张照片');
        });
    };

    /* ------------------------------------------------------------------ *
     *  History / product state
     * ------------------------------------------------------------------ */

    app.captureState = function () {
        return {
            photos: app.photos.map(function (photo) { return Object.assign({}, photo); }),
            shapeKey: app.currentShapeKey,
            density: app.wall.density,
            gap: app.wall.gap,
            placementMode: app.wall.placementMode,
            photoShape: app.wall.photoShape,
            smartPlacement: app.wall.smartPlacement,
            mixedSizes: app.wall.mixedSizes,
            rotationRange: app.wall.rotationRange,
            layoutSeed: app.wall.layoutSeed,
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
        app.stopFlowPlayback(false);
        clearTimeout(app.densityTimer);
        clearTimeout(app.overlapTimer);
        clearTimeout(app.rotationTimer);
        var restoredPhotoIds = new Set(state.photos.map(function (photo) { return photo.id; }));
        app.photos.forEach(function (photo) {
            if (!restoredPhotoIds.has(photo.id)) app.assetManager.releasePhoto(photo);
        });
        app.photos = state.photos.map(function (photo) {
            var restored = Object.assign({}, photo, { img: null });
            app.assetManager.attachURLs(restored);
            return restored;
        });
        app.currentShapeKey = state.shapeKey;

        app.wall.density = state.density;
        app.wall.gap = state.gap;
        app.wall.placementMode = state.placementMode;
        app.wall.photoShape = state.photoShape;
        app.wall.smartPlacement = state.smartPlacement;
        app.wall.mixedSizes = state.mixedSizes !== false;
        app.wall.rotationRange = Number(state.rotationRange) || 0;
        app.wall.layoutSeed = Number(state.layoutSeed) || 1;
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
        app.updatePhotoCount();
        app.renderPhotoLibrary();
        app.renderLayers();
        if (app.photos.length) app.hideEmptyState(); else app.showEmptyState();
        app.updateActionState();
        if (app.autosave && !app.autosaveRestoring) app.autosave.schedule();
    };

    app.undo = function () {
        app.stopFlowPlayback(true);
        if (app.history.undo()) app.toast('已撤销');
    };

    app.redo = function () {
        app.stopFlowPlayback(true);
        if (app.history.redo()) app.toast('已重做');
    };

    app.setPositionMode = function (enabled) {
        if (enabled) app.stopFlowPlayback(true);
        app.localAdjustSnapshot = null;
        app.wall.setInteractionMode(enabled ? 'adjust' : 'swap');
        var button = document.getElementById('position-mode-btn');
        button.classList.toggle('active', enabled);
        button.setAttribute('aria-pressed', String(enabled));
        button.title = enabled ? '拖动照片可调整其在当前格位中的可见区域' : '在格位内移动照片以突出人物';
        document.getElementById('canvas-help').textContent = enabled ?
            '局部调图模式 · 拖动照片可上下左右移动，点击仍可查看原素材' :
            '拖拽素材可交换位置 · 开启局部调图后可在格位内移动人物';
    };

    app.flowTiming = function () {
        var speed = document.getElementById('flow-speed').value;
        return {
            slow: { interval: 5200, transition: 1200 },
            normal: { interval: 3200, transition: 800 },
            fast: { interval: 1800, transition: 500 }
        }[speed] || { interval: 3200, transition: 800 };
    };

    app.runFlowCycle = function () {
        if (!app.flowPlaying || app.photos.length < 2) return;
        var timing = app.flowTiming();
        var seed = app.wall.layoutSeed + 1;
        if (app.wall.randomizeAssignments(seed, timing.transition)) app.flowCycleCount++;
        app.scheduleNextFlowCycle();
    };

    app.scheduleNextFlowCycle = function () {
        clearTimeout(app.flowTimer);
        if (!app.flowPlaying) return;
        app.flowTimer = setTimeout(app.runFlowCycle, app.flowTiming().interval);
    };

    app.startFlowPlayback = function () {
        if (app.photos.length < 2 || app.wall.layout.length < 2) {
            app.toast('至少需要两个素材才能流动播放');
            return;
        }
        app.setPositionMode(false);
        app.flowSnapshot = app.captureState();
        app.flowCycleCount = 0;
        app.flowPlaying = true;
        app.updateFlowControls();
        app.runFlowCycle();
    };

    app.stopFlowPlayback = function (saveHistory) {
        clearTimeout(app.flowTimer);
        app.flowTimer = null;
        if (!app.flowPlaying) return;
        app.flowPlaying = false;
        if (saveHistory && app.flowCycleCount && app.flowSnapshot) app.recordHistory(app.flowSnapshot);
        app.flowSnapshot = null;
        app.flowCycleCount = 0;
        app.updateFlowControls();
    };

    app.updateFlowControls = function () {
        var button = document.getElementById('flow-play-btn');
        if (!button) return;
        button.classList.toggle('active', app.flowPlaying);
        button.setAttribute('aria-pressed', String(app.flowPlaying));
        document.getElementById('flow-play-icon').textContent = app.flowPlaying ? '■' : '▶';
        document.getElementById('flow-play-label').textContent = app.flowPlaying ? '停止流动' : '流动播放';
    };

    app.updateActionState = function () {
        var hasPhotos = app.photos.length > 0;
        if (app.flowPlaying && app.photos.length < 2) app.stopFlowPlayback(false);
        var exportButton = document.getElementById('export-btn');
        var shuffleButton = document.getElementById('shuffle-btn');
        var undoButton = document.getElementById('undo-btn');
        var redoButton = document.getElementById('redo-btn');
        var positionButton = document.getElementById('position-mode-btn');
        var flowButton = document.getElementById('flow-play-btn');
        var flowSpeed = document.getElementById('flow-speed');
        if (exportButton) exportButton.disabled = !hasPhotos;
        if (shuffleButton) shuffleButton.disabled = !hasPhotos;
        if (undoButton) undoButton.disabled = !app.history || !app.history.canUndo();
        if (redoButton) redoButton.disabled = !app.history || !app.history.canRedo();
        if (positionButton) positionButton.disabled = !hasPhotos;
        if (flowButton) flowButton.disabled = app.photos.length < 2;
        if (flowSpeed) flowSpeed.disabled = app.photos.length < 2;
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
        app.stopFlowPlayback(true);
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
            context.roundRect(-width / 2, -height / 2, width, height, 18);
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
        app.stopFlowPlayback(true);
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
        browserPlayer.textContent = '浏览器转码播放';
        systemPlayer.textContent = isNativeApp() ? '使用系统播放器' : '下载原视频';
        if (app.lightboxObjectURL) URL.revokeObjectURL(app.lightboxObjectURL);
        if (app.lightboxTranscodedURL) URL.revokeObjectURL(app.lightboxTranscodedURL);
        app.lightboxTranscodedURL = '';
        app.lightboxTranscodeToken++;
        app.lightboxObjectURL = URL.createObjectURL(photo.originalBlob || photo.workingBlob || photo.blob);
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
            if (photo.posterFallback) {
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
                    info.textContent = photo.name + ' · 当前设备不支持此视频编码，可在浏览器内本地转码播放';
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
        button.textContent = '正在加载视频引擎…';
        import('./video/BrowserVideoTranscoder.js').then(function (module) {
            return module.transcodeVideoForBrowser(source, {
                name: photo.name,
                onStatus: function (status) {
                    if (token !== app.lightboxTranscodeToken) return;
                    button.textContent = status.message || '正在本地转码…';
                    info.textContent = photo.name + ' · 转码仅在当前设备内完成，原文件保持不变';
                }
            });
        }).then(function (playableBlob) {
            if (token !== app.lightboxTranscodeToken || app.photos[app.lightboxIndex] !== photo) return;
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
            button.textContent = '重试浏览器转码';
            info.textContent = photo.name + ' · ' + (error && error.message ? error.message : '本地转码失败');
            document.getElementById('lightbox-system-player').hidden = false;
        });
    };

    /* ------------------------------------------------------------------ *
     *  Export
     * ------------------------------------------------------------------ */

    app.openExportDialog = function () {
        if (app.wall.layout.length === 0) {
            app.toast('请先上传照片');
            return;
        }
        app.stopFlowPlayback(true);
        var dialog = document.getElementById('export-dialog');
        app.exportReturnFocus = document.activeElement;
        document.querySelector('.app').inert = true;
        dialog.classList.add('active');
        dialog.setAttribute('aria-hidden', 'false');
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

    app.updateExportOptions = function () {
        var format = app.getCheckedValue('export-format', 'png');
        var transparentRadio = document.querySelector('input[name="export-background"][value="transparent"]');
        var transparentOption = document.getElementById('transparent-background-option');
        var disabled = format === 'jpeg';
        transparentRadio.disabled = disabled;
        transparentOption.classList.toggle('disabled', disabled);
        if (disabled && transparentRadio.checked) {
            document.querySelector('input[name="export-background"][value="#ffffff"]').checked = true;
            app.toast('JPG 不支持透明背景，已切换为白色');
        }
        document.getElementById('print-export-field').hidden = format !== 'pdf';
        app.updateExportDimensions();
        app.scheduleExportPreview();
    };

    app.updateExportDimensions = function () {
        var target = document.getElementById('export-dimensions');
        if (!target || !app.wall || !app.wall.cssWidth) return;
        var scale = parseInt(app.getCheckedValue('export-scale', '2'), 10);
        var aspectRatio = app.getCheckedValue('export-aspect', 'auto');
        if (app.getCheckedValue('export-format', 'png') === 'pdf') {
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
        var dimensions = app.wall.getExportDimensions(scale, aspectRatio);
        var width = dimensions.width;
        var height = dimensions.height;
        var megapixels = (width * height / 1000000).toFixed(1);
        target.textContent = width + ' × ' + height + ' px · ' + megapixels + ' MP';
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
            var scale = parseInt(app.getCheckedValue('export-scale', '2'), 10);
            var aspectRatio = app.getCheckedValue('export-aspect', 'auto');
            var background = app.getExportBackground();

            var rawName = document.getElementById('export-name').value.trim() || '我的照片墙';
            var fileName = rawName.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').replace(/[. ]+$/, '') || '我的照片墙';
            app.closeExportDialog();
            app.showLoading(true, format === 'pdf' ? '正在生成印刷 PDF…' : '正在生成高清图片…');

            var outputPromise;
            var extension;
            var mime;
            if (format === 'pdf') {
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
                    title: '导出照片墙图片',
                    fileName: fileName + '.' + extension,
                    filters: [{ name: extension.toUpperCase() + (mime === 'application/pdf' ? ' 文档' : ' 图片'), extensions: [extension] }]
                }).then(function (result) {
                    app.showLoading(false);
                    if (result.cancelled) app.toast('已取消导出');
                    else app.toast((format === 'pdf' ? 'PDF' : '图片') + '已导出 · ' + Math.round(blob.size / 1024) + ' KB');
                });
            }).catch(function (error) {
                app.showLoading(false);
                app.toast('导出失败，请降低规格后重试');
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
