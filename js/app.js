import { Shapes, ShapeFactory } from './shapes.js';
import { PhotoWall } from './photowall.js';

/**
 * App controller — wires UI to PhotoWall engine.
 */
'use strict';

    var app = {
        wall: null,
        photos: [],
        lightboxIndex: -1,
        resizeTimer: null,
        densityTimer: null,
        overlapTimer: null,
        rotationTimer: null,
        exportPreviewRAF: null,
        exportReturnFocus: null,
        shapeEditorReturnFocus: null,
        lightboxReturnFocus: null,
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
        undoStack: [],
        redoStack: [],
        historyLimit: 30,
        isRestoring: false,
        photoObjectURLs: new Set(),
        maxPhotos: 1000,
        maxFileSize: 40 * 1024 * 1024,
        maxPhotoDimension: 1600,
        photoLoadConcurrency: 3,
        photoLoadTimeout: 30000,
        supportedImageTypes: ['image/jpeg', 'image/png', 'image/webp']
    };

    /* ------------------------------------------------------------------ *
     *  Init
     * ------------------------------------------------------------------ */

    app.init = function () {
        var canvas = document.getElementById('wall-canvas');
        app.wall = new PhotoWall(canvas);
        app.wall.onPhotoClick = function (item, index) {
            app.openLightbox(index);
        };
        app.wall.onBeforeSwap = function () {
            app.recordHistory();
        };
        app.wall.onSwap = function () {
            app.toast('已交换两张照片的位置');
            app.updateActionState();
        };
        app.wall.onLayout = function (slotCount, largeCount) {
            var status = document.getElementById('canvas-status');
            if (!status) return;
            status.textContent = app.photos.length ?
                app.photos.length + ' 张照片 · ' + slotCount + ' 个填充格位' +
                    (largeCount ? ' · ' + largeCount + ' 个大图' : '') + ' · 本地处理' :
                '所有照片仅在本地处理';
            app.updateExportDimensions();
        };

        app.wall.setShape('china');
        requestAnimationFrame(function () {
            app.wall.resize();
        });

        app.bindUI();
        app.renderShapeButtons();
        app.updateModeHint();
        app.bindPhotoLibrary();
        app.bindShapeCrop();
        app.updateActionState();

        window.addEventListener('resize', function () {
            clearTimeout(app.resizeTimer);
            app.resizeTimer = setTimeout(function () {
                app.wall.resize();
            }, 200);
        });
        window.addEventListener('beforeunload', function () {
            app.photoObjectURLs.forEach(function (url) { URL.revokeObjectURL(url); });
            app.photoObjectURLs.clear();
        });
    };

    /* ------------------------------------------------------------------ *
     *  UI Binding
     * ------------------------------------------------------------------ */

    app.bindUI = function () {
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
        });

        // ---- Actions ----
        document.getElementById('shuffle-btn').addEventListener('click', function () {
            if (!app.photos.length) return;
            app.recordHistory();
            app.wall.shuffle();
            app.toast('已重新排列');
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

    /* ------------------------------------------------------------------ *
     *  Photo handling
     * ------------------------------------------------------------------ */

    app.createId = function (prefix) {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') return prefix + '-' + window.crypto.randomUUID();
        return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    };

    app.handleFiles = function (files) {
        var incoming = Array.prototype.slice.call(files);
        var existingSignatures = new Set(app.photos.map(function (photo) { return photo.signature; }).filter(Boolean));
        var skippedLarge = 0, skippedDuplicate = 0;
        var imageFiles = incoming.filter(function (file) {
            var supportedType = app.supportedImageTypes.indexOf(file.type) >= 0;
            var supportedExtension = /\.(jpe?g|png|webp)$/i.test(file.name);
            if (!supportedType && !supportedExtension) return false;
            if (file.size > app.maxFileSize) { skippedLarge++; return false; }
            var signature = [file.name, file.size, file.lastModified].join(':');
            if (existingSignatures.has(signature)) { skippedDuplicate++; return false; }
            existingSignatures.add(signature);
            return true;
        });
        var remaining = Math.max(0, app.maxPhotos - app.photos.length);
        var skippedLimit = Math.max(0, imageFiles.length - remaining);
        imageFiles = imageFiles.slice(0, remaining);
        if (imageFiles.length === 0) {
            if (!remaining) app.toast('最多支持 ' + app.maxPhotos + ' 张照片');
            else if (skippedDuplicate) app.toast('这些照片已经添加过了');
            else if (skippedLarge) app.toast('单张照片不能超过 40 MB');
            else app.toast('请选择 JPG、PNG 或 WebP 图片');
            return;
        }

        var total = imageFiles.length;
        var importDimension = app.getPhotoImportDimension(app.photos.length + total);
        app.showLoading(true, '正在读取 0/' + total + ' 张照片…');
        app.loadPhotoBatch(imageFiles, function (completed) {
            app.showLoading(true, '正在读取 ' + completed + '/' + total + ' 张照片…');
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
            app.toast('已添加 ' + valid.length + ' 张照片' + (skipped ? ' · 跳过 ' + skipped + ' 张' : ''));
        }).catch(function (err) {
            console.error('批量读取照片失败:', err);
            app.showLoading(false);
            app.toast('照片读取失败，请重试');
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
                console.error('图片加载失败:', files[index].name, err);
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
            var bitmap = null;
            var img = null;
            var objectURL = '';
            var settled = false;
            var timeout = setTimeout(function () {
                if (settled) return;
                settled = true;
                if (bitmap && typeof bitmap.close === 'function') bitmap.close();
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
                if (bitmap && typeof bitmap.close === 'function') bitmap.close();
                bitmap = null;
                if (img) {
                    img.onload = null;
                    img.onerror = null;
                }
                callback(value);
            }

            function createPhoto(loadedImage, source) {
                if (settled) return;
                try {
                    var analysis = PhotoWall.analyzePhoto(loadedImage);
                    finish(resolve, {
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
                        aspectRatio: analysis.aspectRatio,
                        featured: false
                    });
                } catch (err) {
                    finish(reject, err);
                }
            }

            var fileBlob = null;
            app.createPhotoBlob(file, maxDimension).then(function (result) {
                if (settled) {
                    if (result.bitmap && typeof result.bitmap.close === 'function') result.bitmap.close();
                    return;
                }
                bitmap = result.bitmap;
                fileBlob = result.blob;
                objectURL = URL.createObjectURL(fileBlob);
                img = new Image();
                img.onload = function () {
                    app.photoObjectURLs.add(objectURL);
                    createPhoto(img, objectURL);
                };
                img.onerror = function () { finish(reject, new Error('decode failed')); };
                img.src = objectURL;
            }).catch(function (error) {
                finish(reject, error);
            });
        });
    };

    app.getPhotoImportDimension = function (projectedCount) {
        if (projectedCount > 600) return 480;
        if (projectedCount > 300) return 640;
        if (projectedCount > 150) return 800;
        if (projectedCount > 60) return 1200;
        return app.maxPhotoDimension;
    };

    app.createPhotoBlob = function (file, maxDimension) {
        maxDimension = Math.max(320, Math.min(app.maxPhotoDimension, Number(maxDimension) || app.maxPhotoDimension));
        var mime = app.supportedImageTypes.indexOf(file.type) >= 0 ? file.type : '';
        if (!mime) {
            if (/\.png$/i.test(file.name)) mime = 'image/png';
            else if (/\.webp$/i.test(file.name)) mime = 'image/webp';
            else mime = 'image/jpeg';
        }
        var bitmapPromise = typeof window.createImageBitmap === 'function' ?
            window.createImageBitmap(file) : app.createImageBitmapFallback(file);
        return bitmapPromise.then(function (bitmap) {
            var maxSide = Math.max(bitmap.width, bitmap.height);
            if (!maxSide || maxSide <= maxDimension) return { blob: file, bitmap: bitmap };
            var scale = maxDimension / maxSide;
            var canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(bitmap.width * scale));
            canvas.height = Math.max(1, Math.round(bitmap.height * scale));
            canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            return new Promise(function (resolve, reject) {
                canvas.toBlob(function (blob) {
                    canvas.width = 1;
                    canvas.height = 1;
                    if (blob) resolve({ blob: blob, bitmap: bitmap });
                    else reject(new Error('resize encode failed'));
                }, mime, mime === 'image/png' ? undefined : 0.9);
            });
        });
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
        app.recordHistory();
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

    /* ------------------------------------------------------------------ *
     *  Sortable local photo library
     * ------------------------------------------------------------------ */

    app.renderPhotoLibrary = function () {
        var panel = document.getElementById('photo-library-panel');
        var library = document.getElementById('photo-library');
        panel.hidden = app.photos.length === 0;
        var existing = new Map();
        library.querySelectorAll('.photo-card[data-photo-id]').forEach(function (card) {
            existing.set(card.getAttribute('data-photo-id'), card);
        });
        var fragment = document.createDocumentFragment();
        app.photos.forEach(function (photo, index) {
            var card = existing.get(photo.id);
            if (!card) card = app.createPhotoCard(photo);
            existing.delete(photo.id);
            card.setAttribute('data-index', index);
            card.classList.remove('dragging', 'drag-over');
            card.querySelector('.photo-order').textContent = index + 1;
            var image = card.querySelector('img');
            if (image.src !== photo.src) image.src = photo.src;
            image.alt = photo.name || '';
            card.querySelector('.photo-remove').setAttribute('aria-label', '移除 ' + (photo.name || '照片'));
            var feature = card.querySelector('.photo-feature');
            feature.classList.toggle('active', photo.featured === true);
            feature.setAttribute('aria-pressed', photo.featured === true ? 'true' : 'false');
            feature.setAttribute('aria-label', (photo.featured ? '取消重点照片 ' : '设为重点照片 ') + (photo.name || ''));
            fragment.appendChild(card);
        });
        existing.forEach(function (card) { card.remove(); });
        library.appendChild(fragment);
    };

    app.createPhotoCard = function (photo) {
        var card = document.createElement('div');
        card.className = 'photo-card';
        card.draggable = true;
        card.title = '拖拽排序';
        card.setAttribute('data-photo-id', photo.id);
        var order = document.createElement('span');
        order.className = 'photo-order';
        var image = document.createElement('img');
        image.alt = photo.name || '';
        image.decoding = 'async';
        image.loading = 'lazy';
        var remove = document.createElement('button');
        remove.className = 'photo-remove';
        remove.type = 'button';
        remove.textContent = '×';
        var feature = document.createElement('button');
        feature.className = 'photo-feature';
        feature.type = 'button';
        feature.textContent = '★';
        feature.title = '重点照片优先进入大图格位';
        card.appendChild(order);
        card.appendChild(image);
        card.appendChild(feature);
        card.appendChild(remove);
        return card;
    };

    app.escapeHTML = function (value) {
        return String(value).replace(/[&<>'"]/g, function (char) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char];
        });
    };

    app.bindPhotoLibrary = function () {
        var library = document.getElementById('photo-library');
        var dragIndex = -1;
        library.addEventListener('dragstart', function (e) {
            var card = e.target.closest('.photo-card');
            if (!card) return;
            dragIndex = parseInt(card.getAttribute('data-index'), 10);
            card.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });
        library.addEventListener('dragover', function (e) {
            var card = e.target.closest('.photo-card');
            if (!card) return;
            e.preventDefault();
            library.querySelectorAll('.photo-card').forEach(function (item) { item.classList.remove('drag-over'); });
            card.classList.add('drag-over');
        });
        library.addEventListener('drop', function (e) {
            var card = e.target.closest('.photo-card');
            if (!card || dragIndex < 0) return;
            e.preventDefault();
            var target = parseInt(card.getAttribute('data-index'), 10);
            if (target !== dragIndex) {
                app.recordHistory();
                var moved = app.photos.splice(dragIndex, 1)[0];
                app.photos.splice(target, 0, moved);
                app.renderPhotoLibrary();
                app.wall.setPhotos(app.photos);
                app.toast('照片顺序已更新');
            }
            dragIndex = -1;
        });
        library.addEventListener('dragend', function () {
            dragIndex = -1;
            library.querySelectorAll('.photo-card').forEach(function (item) {
                item.classList.remove('dragging', 'drag-over');
            });
        });
        library.addEventListener('click', function (e) {
            var feature = e.target.closest('.photo-feature');
            if (feature) {
                var featureCard = feature.closest('.photo-card');
                var featureIndex = parseInt(featureCard.getAttribute('data-index'), 10);
                if (!app.photos[featureIndex]) return;
                app.recordHistory();
                app.photos[featureIndex].featured = !app.photos[featureIndex].featured;
                app.renderPhotoLibrary();
                app.wall.setPhotos(app.photos);
                app.toast(app.photos[featureIndex].featured ? '已设为重点照片，将优先显示为大图' : '已取消重点照片');
                return;
            }
            var remove = e.target.closest('.photo-remove');
            if (!remove) return;
            var card = remove.closest('.photo-card');
            var index = parseInt(card.getAttribute('data-index'), 10);
            app.recordHistory();
            app.photos.splice(index, 1);
            app.updatePhotoCount();
            app.renderPhotoLibrary();
            app.wall.setPhotos(app.photos);
            if (!app.photos.length) app.showEmptyState();
            app.toast('已移除照片');
        });
    };

    /* ------------------------------------------------------------------ *
     *  Portable project files
     * ------------------------------------------------------------------ */

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
            version: 1,
            savedAt: new Date().toISOString(),
            shape: shapeData,
            settings: {
                density: app.wall.density,
                gap: app.wall.gap,
                placementMode: app.wall.placementMode,
                photoShape: app.wall.photoShape,
                smartPlacement: app.wall.smartPlacement,
                mixedSizes: app.wall.mixedSizes,
                rotationRange: app.wall.rotationRange
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
                    aspectRatio: photo.aspectRatio,
                    featured: photo.featured === true
                };
            }),
            layout: app.wall.getLayoutSnapshot()
        };
    };

    app.saveProject = function () {
        if (!app.photos.length) {
            app.toast('请先添加照片');
            return;
        }
        app.showLoading(true, '正在打包项目…');
        Promise.all(app.photos.map(function (photo) {
            if (photo.blob) return app.blobToDataURL(photo.blob);
            if (/^data:image\//i.test(photo.src)) return Promise.resolve(photo.src);
            return fetch(photo.src).then(function (response) {
                if (!response.ok) throw new Error('photo fetch failed');
                return response.blob();
            }).then(app.blobToDataURL);
        })).then(function (photoSources) {
            var project = app.serializeProject(photoSources);
            var blob = new Blob([JSON.stringify(project)], { type: 'application/json' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            var rawName = document.getElementById('export-name').value.trim() || '我的照片墙';
            var name = rawName.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').replace(/[. ]+$/, '') || '我的照片墙';
            a.href = url;
            a.download = name + '.photowall.json';
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
            app.showLoading(false);
            app.toast('项目已保存，可继续编辑');
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

    app.openProject = function (file) {
        if (!file || file.size > 300 * 1024 * 1024) {
            app.toast('项目文件无效或超过 300 MB');
            return;
        }
        app.showLoading(true, '正在打开项目…');
        var reader = new FileReader();
        reader.onload = function (event) {
            try {
                var project = JSON.parse(event.target.result);
                if (!project || project.format !== 'photo-wall-project' || project.version !== 1 || !Array.isArray(project.photos)) {
                    throw new Error('unsupported project');
                }
                if (project.photos.length > app.maxPhotos) throw new Error('too many photos');
                app.restoreProject(project).catch(function (error) {
                    console.error(error);
                    app.showLoading(false);
                    app.toast('项目内容损坏或图片无法读取');
                });
            } catch (error) {
                console.error(error);
                app.showLoading(false);
                app.toast('不是有效的照片墙项目文件');
            }
        };
        reader.onerror = function () {
            app.showLoading(false);
            app.toast('项目文件读取失败');
        };
        reader.readAsText(file);
    };

    app.loadProjectPhoto = function (saved) {
        return new Promise(function (resolve, reject) {
            if (!saved || typeof saved.src !== 'string' || !/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(saved.src)) {
                reject(new Error('invalid photo source'));
                return;
            }
            var img = new Image();
            var settled = false;
            var timeout = setTimeout(function () {
                if (settled) return;
                settled = true;
                img.onload = null;
                img.onerror = null;
                img.src = '';
                reject(new Error('project photo load timed out'));
            }, app.photoLoadTimeout);

            function finish(callback, value) {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                img.onload = null;
                img.onerror = null;
                callback(value);
            }

            img.onload = function () {
                try {
                    var analysis = PhotoWall.analyzePhoto(img);
                    finish(resolve, {
                        id: saved.id || app.createId('photo'),
                        img: img,
                        src: saved.src,
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
                        focusX: Number.isFinite(saved.focusX) ? saved.focusX : analysis.focusX,
                        focusY: Number.isFinite(saved.focusY) ? saved.focusY : analysis.focusY,
                        aspectRatio: Number.isFinite(saved.aspectRatio) ? saved.aspectRatio : analysis.aspectRatio,
                        featured: saved.featured === true
                    });
                } catch (error) {
                    finish(reject, error);
                }
            };
            img.onerror = function () { finish(reject, new Error('photo decode failed')); };
            img.src = saved.src;
        });
    };

    app.loadProjectPhotoBatch = function (savedPhotos, onProgress) {
        var results = new Array(savedPhotos.length);
        var nextIndex = 0;
        var completed = 0;
        var workerCount = Math.min(app.photoLoadConcurrency, savedPhotos.length);

        function runWorker() {
            var index = nextIndex++;
            if (index >= savedPhotos.length) return Promise.resolve();
            return app.loadProjectPhoto(savedPhotos[index]).then(function (photo) {
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

    app.restoreProject = function (project) {
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
            app.undoStack = [];
            app.redoStack = [];
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
                arrangement: [],
                layout: project.layout
            });
            app.showLoading(false);
            app.toast('项目已恢复 · ' + photos.length + ' 张照片');
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
            arrangement: app.wall.getArrangement(),
            layout: app.wall.getLayoutSnapshot()
        };
    };

    app.recordHistory = function (snapshot) {
        if (app.isRestoring || !app.wall) return;
        app.undoStack.push(snapshot || app.captureState());
        if (app.undoStack.length > app.historyLimit) app.undoStack.shift();
        app.redoStack = [];
        app.updateActionState();
    };

    app.restoreState = function (state) {
        if (!state) return;
        clearTimeout(app.densityTimer);
        clearTimeout(app.overlapTimer);
        clearTimeout(app.rotationTimer);
        app.isRestoring = true;
        app.photos = state.photos.map(function (photo) { return Object.assign({}, photo); });
        app.currentShapeKey = state.shapeKey;

        app.wall.density = state.density;
        app.wall.gap = state.gap;
        app.wall.placementMode = state.placementMode;
        app.wall.photoShape = state.photoShape;
        app.wall.smartPlacement = state.smartPlacement;
        app.wall.mixedSizes = state.mixedSizes !== false;
        app.wall.rotationRange = Number(state.rotationRange) || 0;
        app.wall.shapeKey = state.shapeKey;
        app.wall.shape = Shapes[state.shapeKey];
        app.wall.photos = app.photos;
        app.wall.generateLayout(false, true);
        if (!app.wall.setLayoutSnapshot(state.layout)) app.wall.setArrangement(state.arrangement);

        document.querySelectorAll('.shape-btn').forEach(function (button) {
            button.classList.toggle('active', button.getAttribute('data-shape') === state.shapeKey);
        });
        document.querySelectorAll('.mode-btn').forEach(function (button) {
            button.classList.toggle('active', button.getAttribute('data-mode') === state.placementMode);
        });
        document.querySelectorAll('.ps-btn').forEach(function (button) {
            button.classList.toggle('active', button.getAttribute('data-pshape') === state.photoShape);
        });
        document.getElementById('density-slider').value = state.density;
        document.getElementById('density-value').textContent = Math.round(state.density * 100) + '%';
        document.getElementById('overlap-slider').value = state.gap;
        document.getElementById('overlap-value').textContent = Math.round(state.gap * 100) + '%';
        document.getElementById('smart-toggle').checked = state.smartPlacement;
        document.getElementById('mixed-size-toggle').checked = app.wall.mixedSizes;
        document.getElementById('rotation-slider').value = app.wall.rotationRange;
        document.getElementById('rotation-value').textContent = app.wall.rotationRange + '°';
        app.updateModeHint();
        app.updatePhotoCount();
        app.renderPhotoLibrary();
        if (app.photos.length) app.hideEmptyState(); else app.showEmptyState();
        app.isRestoring = false;
        app.updateActionState();
    };

    app.undo = function () {
        if (!app.undoStack.length) return;
        var state = app.undoStack.pop();
        app.redoStack.push(app.captureState());
        app.restoreState(state);
        app.toast('已撤销');
    };

    app.redo = function () {
        if (!app.redoStack.length) return;
        var state = app.redoStack.pop();
        app.undoStack.push(app.captureState());
        app.restoreState(state);
        app.toast('已重做');
    };

    app.updateActionState = function () {
        var hasPhotos = app.photos.length > 0;
        var exportButton = document.getElementById('export-btn');
        var shuffleButton = document.getElementById('shuffle-btn');
        var undoButton = document.getElementById('undo-btn');
        var redoButton = document.getElementById('redo-btn');
        if (exportButton) exportButton.disabled = !hasPhotos;
        if (shuffleButton) shuffleButton.disabled = !hasPhotos;
        if (undoButton) undoButton.disabled = app.undoStack.length === 0;
        if (redoButton) redoButton.disabled = app.redoStack.length === 0;
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
     *  Lightbox
     * ------------------------------------------------------------------ */

    app.openLightbox = function (index) {
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
        app.lightboxIndex = -1;
    };

    app.navigateLightbox = function (dir) {
        if (app.lightboxIndex < 0) return;
        var n = app.wall.layout.length;
        app.lightboxIndex = (app.lightboxIndex + dir + n) % n;
        app.updateLightboxImage();
    };

    app.updateLightboxImage = function () {
        var item = app.wall.layout[app.lightboxIndex];
        if (!item) return;
        var img = document.getElementById('lightbox-img');
        img.src = item.photo.src;
        var info = document.getElementById('lightbox-info');
        info.textContent = item.photo.name + '  ·  ' +
            item.photo.img.naturalWidth + '×' + item.photo.img.naturalHeight;
    };

    /* ------------------------------------------------------------------ *
     *  Export
     * ------------------------------------------------------------------ */

    app.openExportDialog = function () {
        if (app.wall.layout.length === 0) {
            app.toast('请先上传照片');
            return;
        }
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
        app.updateExportDimensions();
        app.scheduleExportPreview();
    };

    app.updateExportDimensions = function () {
        var target = document.getElementById('export-dimensions');
        if (!target || !app.wall || !app.wall.cssWidth) return;
        var scale = parseInt(app.getCheckedValue('export-scale', '2'), 10);
        var aspectRatio = app.getCheckedValue('export-aspect', 'auto');
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
        var dimensions = app.wall.getExportDimensions(1, aspectRatio);
        var previewScale = Math.min(1, 720 / Math.max(dimensions.width, dimensions.height));
        var source = app.wall.createExportCanvas({
            scale: previewScale,
            background: background,
            aspectRatio: aspectRatio
        });
        var preview = document.getElementById('export-preview-canvas');
        preview.width = source.width;
        preview.height = source.height;
        var context = preview.getContext('2d');
        context.clearRect(0, 0, preview.width, preview.height);
        context.drawImage(source, 0, 0);
        document.getElementById('export-preview-ratio').textContent = {
            auto: '紧贴轮廓',
            '3:4': '3:4 常用照片',
            '9:16': '9:16 手机竖屏'
        }[aspectRatio] || aspectRatio;
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
            var mime = format === 'jpeg' ? 'image/jpeg' : 'image/' + format;
            var extension = format === 'jpeg' ? 'jpg' : format;

            app.closeExportDialog();
            app.showLoading(true, '正在生成高清图片…');
            var output = app.wall.createExportCanvas({ scale: scale, background: background, aspectRatio: aspectRatio });
            output.toBlob(function (blob) {
                app.showLoading(false);
                if (!blob) {
                    app.toast('导出失败，请降低清晰度后重试');
                    return;
                }
                var url = URL.createObjectURL(blob);
                var a = document.createElement('a');
                a.href = url;
                a.download = fileName + '.' + extension;
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
                app.toast('图片已导出 · ' + Math.round(blob.size / 1024) + ' KB');
            }, mime, 0.94);
        } catch (err) {
            app.showLoading(false);
            app.toast('导出失败');
            console.error(err);
        }
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
