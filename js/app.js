/**
 * App controller — wires UI to PhotoWall engine.
 */
(function () {
    'use strict';

    var app = {
        wall: null,
        photos: [],
        lightboxIndex: -1,
        resizeTimer: null,
        densityTimer: null,
        overlapTimer: null,
        currentShapeKey: 'china',
        pendingShapeImage: null,
        shapePreviewRAF: null,
        maskStrokes: [],
        maskBrushMode: 'keep',
        maskBrushPointerId: null,
        maskPreviewMeta: null,
        undoStack: [],
        redoStack: [],
        historyLimit: 30,
        isRestoring: false,
        maxPhotos: 200,
        maxFileSize: 40 * 1024 * 1024,
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
        app.wall.onLayout = function (slotCount) {
            var status = document.getElementById('canvas-status');
            if (!status) return;
            status.textContent = app.photos.length ?
                app.photos.length + ' 张照片 · ' + slotCount + ' 个填充格位 · 本地处理' :
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
        app.updateActionState();

        window.addEventListener('resize', function () {
            clearTimeout(app.resizeTimer);
            app.resizeTimer = setTimeout(function () {
                app.wall.resize();
            }, 200);
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
            var defaults = { portrait: 46, auto: 42, threshold: 128 };
            threshold.value = defaults[e.target.value] || 46;
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

        // ---- Smart placement toggle ----
        document.getElementById('smart-toggle').addEventListener('change', function (e) {
            app.recordHistory();
            app.wall.setSmartPlacement(e.target.checked);
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

        // ---- Export dialog ----
        document.getElementById('export-close').addEventListener('click', app.closeExportDialog);
        document.getElementById('export-cancel').addEventListener('click', app.closeExportDialog);
        document.getElementById('export-dialog').addEventListener('click', function (e) {
            if (e.target === this) app.closeExportDialog();
        });
        document.querySelectorAll('input[name="export-format"], input[name="export-scale"]').forEach(function (input) {
            input.addEventListener('change', app.updateExportOptions);
        });
        document.getElementById('export-background-color').addEventListener('input', function () {
            document.querySelector('input[name="export-background"][value="custom"]').checked = true;
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
            if (e.key === 'Escape' && document.getElementById('export-dialog').classList.contains('active')) {
                app.closeExportDialog();
                return;
            }
            var lb = document.getElementById('lightbox');
            if (!lb.classList.contains('active')) return;
            if (e.key === 'Escape') app.closeLightbox();
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
            strokes: app.maskStrokes
        };
    };

    app.openShapeEditor = function (img) {
        app.pendingShapeImage = img;
        document.getElementById('shape-extract-mode').value = 'portrait';
        document.getElementById('shape-threshold').value = '46';
        document.getElementById('shape-smooth').value = '1';
        document.getElementById('shape-denoise').value = '2';
        document.getElementById('shape-largest').checked = true;
        document.getElementById('shape-invert').checked = false;
        app.maskStrokes = [];
        app.maskBrushPointerId = null;
        app.maskPreviewMeta = null;
        app.setMaskBrushMode('keep');
        app.updateMaskBrushActions();
        document.getElementById('shape-mask-preview').classList.add('editable');
        app.updateShapeModeUI('portrait');
        document.getElementById('shape-editor').classList.add('active');
        requestAnimationFrame(app.updateShapePreview);
    };

    app.updateShapeModeUI = function (mode) {
        var tips = {
            portrait: '适合人物照片：从图片边缘识别背景，并保护相近肤色',
            auto: '适合 Logo、商品等纯色背景图片',
            threshold: '适合黑白图案：低于阈值的深色区域会成为主体'
        };
        document.getElementById('shape-extract-tip').textContent = tips[mode] || tips.portrait;
    };

    app.closeShapeEditor = function () {
        document.getElementById('shape-editor').classList.remove('active');
        app.pendingShapeImage = null;
        app.maskBrushPointerId = null;
        app.maskPreviewMeta = null;
        if (app.shapePreviewRAF) cancelAnimationFrame(app.shapePreviewRAF);
        app.shapePreviewRAF = null;
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
            app.drawPreviewCanvas(document.getElementById('shape-source-preview'), result.sourceCanvas);
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
        document.getElementById('shape-editor').classList.remove('active');
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
        var keys = ['china', 'heart', 'portrait'];
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

        app.showLoading(true, '正在读取 ' + imageFiles.length + ' 张照片…');

        var total = imageFiles.length;
        Promise.all(imageFiles.map(function (file) {
            return app.loadPhoto(file).catch(function (err) {
                console.error('图片加载失败:', err);
                return null;
            });
        })).then(function (loadedPhotos) {
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
        });
    };

    app.loadPhoto = function (file) {
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function (e) {
                var img = new Image();
                img.onload = function () {
                    var analysis = PhotoWall.analyzePhoto(img);
                    resolve({
                        img: img,
                        src: e.target.result,
                        name: file.name,
                        signature: [file.name, file.size, file.lastModified].join(':'),
                        r: analysis.r,
                        g: analysis.g,
                        b: analysis.b,
                        brightness: analysis.brightness,
                        hue: analysis.hue
                    });
                };
                img.onerror = function () { reject(new Error('decode failed')); };
                img.src = e.target.result;
            };
            reader.onerror = function () { reject(new Error('read failed')); };
            reader.readAsDataURL(file);
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
        library.innerHTML = app.photos.map(function (photo, index) {
            return '<div class="photo-card" draggable="true" data-index="' + index + '" title="拖拽排序">' +
                '<span class="photo-order">' + (index + 1) + '</span>' +
                '<img src="' + photo.src + '" alt="">' +
                '<button class="photo-remove" type="button" aria-label="移除 ' + app.escapeHTML(photo.name) + '">×</button>' +
                '</div>';
        }).join('');
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
     *  History / product state
     * ------------------------------------------------------------------ */

    app.captureState = function () {
        return {
            photos: app.photos.slice(),
            shapeKey: app.currentShapeKey,
            density: app.wall.density,
            gap: app.wall.gap,
            placementMode: app.wall.placementMode,
            photoShape: app.wall.photoShape,
            smartPlacement: app.wall.smartPlacement,
            arrangement: app.wall.getArrangement()
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
        app.isRestoring = true;
        app.photos = state.photos.slice();
        app.currentShapeKey = state.shapeKey;

        app.wall.density = state.density;
        app.wall.gap = state.gap;
        app.wall.placementMode = state.placementMode;
        app.wall.photoShape = state.photoShape;
        app.wall.smartPlacement = state.smartPlacement;
        app.wall.shapeKey = state.shapeKey;
        app.wall.shape = Shapes[state.shapeKey];
        app.wall.photos = app.photos;
        app.wall.generateLayout(false, true);
        app.wall.setArrangement(state.arrangement);

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
        app.updateLightboxImage();
        lb.classList.add('active');
    };

    app.closeLightbox = function () {
        document.getElementById('lightbox').classList.remove('active');
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
    };

    app.updateExportDimensions = function () {
        var target = document.getElementById('export-dimensions');
        if (!target || !app.wall || !app.wall.cssWidth) return;
        var scale = parseInt(app.getCheckedValue('export-scale', '2'), 10);
        var width = Math.round(app.wall.cssWidth * scale);
        var height = Math.round(app.wall.cssHeight * scale);
        var megapixels = (width * height / 1000000).toFixed(1);
        target.textContent = width + ' × ' + height + ' px · ' + megapixels + ' MP';
    };

    app.exportImage = function () {
        if (app.wall.layout.length === 0) {
            app.toast('请先上传照片');
            return;
        }
        try {
            var format = app.getCheckedValue('export-format', 'png');
            var scale = parseInt(app.getCheckedValue('export-scale', '2'), 10);
            var background = app.getCheckedValue('export-background', '#ffffff');
            if (background === 'custom') background = document.getElementById('export-background-color').value;
            if (format === 'jpeg' && background === 'transparent') background = '#ffffff';

            var rawName = document.getElementById('export-name').value.trim() || '我的照片墙';
            var fileName = rawName.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').replace(/[. ]+$/, '') || '我的照片墙';
            var mime = format === 'jpeg' ? 'image/jpeg' : 'image/' + format;
            var extension = format === 'jpeg' ? 'jpg' : format;

            app.closeExportDialog();
            app.showLoading(true, '正在生成高清图片…');
            var output = app.wall.createExportCanvas({ scale: scale, background: background });
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
})();
