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
        shapePreviewRAF: null
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
        app.wall.onSwap = function () {
            app.toast('已交换两张照片的位置');
        };
        app.wall.onLayout = function (slotCount) {
            var status = document.getElementById('canvas-status');
            if (!status) return;
            status.textContent = app.photos.length ?
                app.photos.length + ' 张照片 · ' + slotCount + ' 个填充格位 · 本地处理' :
                '所有照片仅在本地处理';
        };

        app.wall.setShape('china');
        requestAnimationFrame(function () {
            app.wall.resize();
        });

        app.bindUI();
        app.renderShapeButtons();
        app.updateModeHint();
        app.bindPhotoLibrary();

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
        ['shape-threshold', 'shape-smooth', 'shape-largest', 'shape-invert'].forEach(function (id) {
            document.getElementById(id).addEventListener('input', app.scheduleShapePreview);
            document.getElementById(id).addEventListener('change', app.scheduleShapePreview);
        });
        document.getElementById('shape-extract-mode').addEventListener('change', function (e) {
            var threshold = document.getElementById('shape-threshold');
            threshold.value = e.target.value === 'threshold' ? 128 : 42;
            app.scheduleShapePreview();
        });
        document.getElementById('shape-editor-confirm').addEventListener('click', app.confirmShapeEditor);
        document.getElementById('shape-editor-cancel').addEventListener('click', app.closeShapeEditor);
        document.getElementById('shape-editor-close').addEventListener('click', app.closeShapeEditor);
        document.getElementById('shape-editor').addEventListener('click', function (e) {
            if (e.target === this) app.closeShapeEditor();
        });

        // ---- Photo upload ----
        var fileInput = document.getElementById('file-input');
        fileInput.addEventListener('change', function (e) {
            app.handleFiles(e.target.files);
            e.target.value = '';
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
        densitySlider.addEventListener('input', function (e) {
            var val = parseFloat(e.target.value);
            densityValue.textContent = Math.round(val * 100) + '%';
            clearTimeout(app.densityTimer);
            app.densityTimer = setTimeout(function () {
                app.wall.setDensity(val);
            }, 120);
        });

        // ---- Overlap slider ----
        var overlapSlider = document.getElementById('overlap-slider');
        var overlapValue = document.getElementById('overlap-value');
        overlapSlider.addEventListener('input', function (e) {
            var val = parseFloat(e.target.value);
            overlapValue.textContent = Math.round(val * 100) + '%';
            clearTimeout(app.overlapTimer);
            app.overlapTimer = setTimeout(function () {
                app.wall.setOverlap(val);
            }, 120);
        });

        // ---- Smart placement toggle ----
        document.getElementById('smart-toggle').addEventListener('change', function (e) {
            app.wall.setSmartPlacement(e.target.checked);
        });

        // ---- Placement mode buttons ----
        var modeContainer = document.getElementById('mode-buttons');
        modeContainer.addEventListener('click', function (e) {
            var btn = e.target.closest('.mode-btn');
            if (!btn) return;
            document.querySelectorAll('.mode-btn').forEach(function (b) {
                b.classList.remove('active');
            });
            btn.classList.add('active');
            var mode = btn.getAttribute('data-mode');
            app.wall.setPlacementMode(mode);
            app.updateModeHint();
        });

        // ---- Photo shape buttons ----
        var psContainer = document.getElementById('photo-shape-buttons');
        psContainer.addEventListener('click', function (e) {
            var btn = e.target.closest('.ps-btn');
            if (!btn) return;
            document.querySelectorAll('.ps-btn').forEach(function (b) {
                b.classList.remove('active');
            });
            btn.classList.add('active');
            app.wall.setPhotoShape(btn.getAttribute('data-pshape'));
        });

        // ---- Actions ----
        document.getElementById('shuffle-btn').addEventListener('click', function () {
            app.wall.shuffle();
            app.toast('已重新排列');
        });
        document.getElementById('clear-btn').addEventListener('click', function () {
            app.clearPhotos();
        });
        document.getElementById('export-btn').addEventListener('click', function () {
            app.exportImage();
        });

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
            if (e.key === 'Escape' && document.getElementById('shape-editor').classList.contains('active')) {
                app.closeShapeEditor();
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

    app.getShapeEditorOptions = function () {
        return {
            mode: document.getElementById('shape-extract-mode').value,
            threshold: parseInt(document.getElementById('shape-threshold').value, 10),
            smooth: parseInt(document.getElementById('shape-smooth').value, 10),
            keepLargest: document.getElementById('shape-largest').checked,
            invert: document.getElementById('shape-invert').checked
        };
    };

    app.openShapeEditor = function (img) {
        app.pendingShapeImage = img;
        document.getElementById('shape-extract-mode').value = 'auto';
        document.getElementById('shape-threshold').value = '42';
        document.getElementById('shape-smooth').value = '1';
        document.getElementById('shape-largest').checked = true;
        document.getElementById('shape-invert').checked = false;
        document.getElementById('shape-editor').classList.add('active');
        requestAnimationFrame(app.updateShapePreview);
    };

    app.closeShapeEditor = function () {
        document.getElementById('shape-editor').classList.remove('active');
        app.pendingShapeImage = null;
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
        ctx.drawImage(source, (width - drawW) / 2, (height - drawH) / 2, drawW, drawH);
    };

    app.updateShapePreview = function () {
        if (!app.pendingShapeImage) return;
        var options = app.getShapeEditorOptions();
        document.getElementById('shape-threshold-value').textContent = options.threshold;
        document.getElementById('shape-smooth-value').textContent = options.smooth;
        try {
            var result = ShapeFactory.createImageMask(app.pendingShapeImage, options, 320);
            app.drawPreviewCanvas(document.getElementById('shape-source-preview'), result.sourceCanvas);
            app.drawPreviewCanvas(document.getElementById('shape-mask-preview'), result.canvas);
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
        return '<button class="shape-btn' + (active ? ' active' : '') + '" data-shape="' + key + '">' +
            '<svg viewBox="0 0 ' + shape.viewBox.width + ' ' + shape.viewBox.height + '" preserveAspectRatio="xMidYMid meet">' +
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
        var imageFiles = Array.prototype.filter.call(files, function (f) {
            return f.type.startsWith('image/');
        });
        if (imageFiles.length === 0) {
            app.toast('请选择图片文件');
            return;
        }

        app.showLoading(true);

        var total = imageFiles.length;
        Promise.all(imageFiles.map(function (file) {
            return app.loadPhoto(file).catch(function (err) {
                console.error('图片加载失败:', err);
                return null;
            });
        })).then(function (loadedPhotos) {
            var valid = loadedPhotos.filter(Boolean);
            Array.prototype.push.apply(app.photos, valid);
            app.updatePhotoCount();
            app.renderPhotoLibrary();
            app.wall.setPhotos(app.photos);
            if (app.photos.length) app.hideEmptyState();
            app.showLoading(false);
            app.toast(valid.length === total ? '已添加 ' + total + ' 张照片' : '已添加 ' + valid.length + ' 张，部分文件无法读取');
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
        app.photos = [];
        app.updatePhotoCount();
        app.wall.setPhotos([]);
        app.renderPhotoLibrary();
        app.showEmptyState();
        app.toast('已清空照片');
    };

    app.updatePhotoCount = function () {
        document.getElementById('photo-count').textContent = app.photos.length;
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
            app.photos.splice(index, 1);
            app.updatePhotoCount();
            app.renderPhotoLibrary();
            app.wall.setPhotos(app.photos);
            if (!app.photos.length) app.showEmptyState();
            app.toast('已移除照片');
        });
    };

    /* ------------------------------------------------------------------ *
     *  Empty state / loading
     * ------------------------------------------------------------------ */

    app.hideEmptyState = function () {
        var el = document.getElementById('empty-state');
        if (el) el.style.display = 'none';
    };

    app.showEmptyState = function () {
        var el = document.getElementById('empty-state');
        if (el) el.style.display = 'flex';
    };

    app.showLoading = function (on, text) {
        var el = document.getElementById('loading-overlay');
        el.classList.toggle('active', on);
        if (text) document.getElementById('loading-text').textContent = text;
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

    app.exportImage = function () {
        if (app.wall.layout.length === 0) {
            app.toast('请先上传照片');
            return;
        }
        try {
            var url = app.wall.exportPNG(2);
            var a = document.createElement('a');
            a.href = url;
            a.download = 'photo-wall-' + Date.now() + '.png';
            a.click();
            app.toast('图片已导出');
        } catch (err) {
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
