/**
 * PhotoWall — shape-aware mosaic engine.
 * Photos are tiled across the silhouette bounds and the final composition is
 * clipped by one shared mask. This guarantees that no photo pixel can escape
 * the selected outline while boundary cells still cover it completely.
 */
import { Shapes } from './shapes.js';
import { computeDistanceTransform, sampleDistance } from './mask/DistanceTransform.js';
import { assignPhotosToCells } from './layout/SmartPlacement.js';

'use strict';

    function PhotoWall(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.shape = null;
        this.shapeKey = null;
        this.photos = [];
        this.layout = [];
        this.maskData = null;
        this._maskCacheKey = '';
        this._maskShape = null;
        this._renderOrder = [];
        this._hitOrder = [];
        this.density = 1;
        this.gap = 0;
        this.placementMode = 'grid';
        this.photoShape = 'square';
        this.smartPlacement = true;
        this.mixedSizes = true;
        this.rotationRange = 0;
        this.hoveredIndex = -1;
        this.draggingIndex = -1;
        this.dragOverIndex = -1;
        this.pointer = null;
        this.onPhotoClick = null;
        this.onBeforeSwap = null;
        this.onSwap = null;
        this.onLayout = null;
        this._animStart = 0;
        this._animRAF = null;
        this._pointerDown = null;
        this._slotSequence = 0;
        this._layerCanvas = document.createElement('canvas');
        this._layerContext = this._layerCanvas.getContext('2d');
        this._bindEvents();
    }

    PhotoWall.prototype.resize = function () {
        var previousLayout = this.layout.length ? this.getLayoutSnapshot() : null;
        var rect = this.canvas.parentElement.getBoundingClientRect();
        this.cssWidth = Math.max(100, rect.width);
        this.cssHeight = Math.max(100, rect.height);
        this.dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.canvas.width = Math.round(this.cssWidth * this.dpr);
        this.canvas.height = Math.round(this.cssHeight * this.dpr);
        this.canvas.style.width = this.cssWidth + 'px';
        this.canvas.style.height = this.cssHeight + 'px';
        this._layerCanvas.width = this.canvas.width;
        this._layerCanvas.height = this.canvas.height;
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        if (this.shape) {
            this.generateMask();
            if (previousLayout && this.photos.length) this.setLayoutSnapshot(previousLayout);
            else this.generateLayout(false, true);
        }
    };

    PhotoWall.prototype.setShape = function (key) {
        this.shapeKey = key;
        this.shape = Shapes[key];
        if (this.shape) this.generateLayout();
    };
    PhotoWall.prototype.setPhotos = function (photos) {
        this.photos = photos || [];
        if (this.shape) this.generateLayout();
    };
    PhotoWall.prototype.setDensity = function (value) {
        this.density = value;
        if (this.shape) this.generateLayout();
    };
    PhotoWall.prototype.setOverlap = function (value) {
        this.gap = value;
        if (this.shape) this.generateLayout();
    };
    PhotoWall.prototype.setPlacementMode = function (mode) {
        this.placementMode = mode;
        if (this.shape) this.generateLayout();
    };
    PhotoWall.prototype.setPhotoShape = function (shape) {
        this.photoShape = shape;
        this.render();
    };
    PhotoWall.prototype.setSmartPlacement = function (enabled) {
        this.smartPlacement = enabled;
        if (this.shape) this.generateLayout();
    };
    PhotoWall.prototype.setMixedSizes = function (enabled) {
        this.mixedSizes = enabled;
        if (this.shape) this.generateLayout();
    };
    PhotoWall.prototype.setRotationRange = function (value) {
        this.rotationRange = Math.max(0, Math.min(24, Number(value) || 0));
        if (this.shape) this.generateLayout();
    };
    PhotoWall.prototype.shuffle = function () {
        if (!this.layout.length) return;
        for (var i = this.layout.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            this._swapAssignments(i, j);
        }
        this._animate();
    };

    PhotoWall.prototype.generateMask = function () {
        if (!this.cssWidth || !this.cssHeight || !this.shape) return;
        var w = Math.round(this.cssWidth), h = Math.round(this.cssHeight);
        var cacheKey = this.shapeKey + ':' + w + 'x' + h;
        if (this.maskData && this._maskCacheKey === cacheKey && this._maskShape === this.shape) return;
        var maskCanvas = document.createElement('canvas');
        maskCanvas.width = w; maskCanvas.height = h;
        var ctx = maskCanvas.getContext('2d', { willReadFrequently: true });
        var margin = Math.max(24, Math.min(w, h) * 0.055);
        var availW = Math.max(20, w - margin * 2), availH = Math.max(20, h - margin * 2);
        var shapeW, shapeH, scale, drawW, drawH, offX, offY;

        ctx.fillStyle = '#fff';
        if (this.shape.maskCanvas) {
            shapeW = this.shape.maskCanvasW || this.shape.maskCanvas.width;
            shapeH = this.shape.maskCanvasH || this.shape.maskCanvas.height;
            scale = Math.min(availW / shapeW, availH / shapeH);
            drawW = shapeW * scale; drawH = shapeH * scale;
            offX = (w - drawW) / 2; offY = (h - drawH) / 2;
            ctx.drawImage(this.shape.maskCanvas, offX, offY, drawW, drawH);
        } else {
            shapeW = this.shape.viewBox.width; shapeH = this.shape.viewBox.height;
            scale = Math.min(availW / shapeW, availH / shapeH);
            drawW = shapeW * scale; drawH = shapeH * scale;
            offX = (w - drawW) / 2; offY = (h - drawH) / 2;
            ctx.save(); ctx.translate(offX, offY); ctx.scale(scale, scale);
            for (var p = 0; p < this.shape.paths.length; p++) ctx.fill(new Path2D(this.shape.paths[p]));
            ctx.restore();
        }

        var sourceImage = ctx.getImageData(0, 0, w, h);
        var imageData = sourceImage.data;
        var cleanMask = ctx.createImageData(w, h);
        var mask = new Uint8Array(w * h), minX = w, minY = h, maxX = 0, maxY = 0, count = 0;
        var integral = new Uint32Array((w + 1) * (h + 1));
        for (var y = 0; y < h; y++) {
            var rowSum = 0;
            for (var x = 0; x < w; x++) {
                var pixel = (y * w + x) * 4;
                // Dynamic masks are stored as opaque black/white canvases, while
                // built-in paths use transparent/white pixels. Requiring both a
                // light colour and visible alpha handles both representations.
                var softAlpha = Math.round(imageData[pixel + 3] * imageData[pixel] / 255);
                var inside = softAlpha > 127 ? 1 : 0;
                mask[y * w + x] = inside;
                cleanMask.data[pixel] = 255;
                cleanMask.data[pixel + 1] = 255;
                cleanMask.data[pixel + 2] = 255;
                cleanMask.data[pixel + 3] = softAlpha;
                rowSum += inside;
                integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + rowSum;
                if (inside) {
                    count++;
                    if (x < minX) minX = x; if (x > maxX) maxX = x;
                    if (y < minY) minY = y; if (y > maxY) maxY = y;
                }
            }
        }
        ctx.clearRect(0, 0, w, h);
        ctx.putImageData(cleanMask, 0, 0);
        this.maskData = {
            mask: mask, maskCanvas: maskCanvas, integral: integral,
            distance: computeDistanceTransform(mask, w, h), width: w, height: h,
            bounds: { x: minX, y: minY, width: Math.max(1, maxX - minX + 1), height: Math.max(1, maxY - minY + 1) },
            offX: offX, offY: offY, drawW: drawW, drawH: drawH, scale: scale, insideCount: count
        };
        this._maskCacheKey = cacheKey;
        this._maskShape = this.shape;
    };

    PhotoWall.prototype._rectMaskArea = function (x, y, width, height) {
        var md = this.maskData, stride = md.width + 1;
        var x1 = Math.max(0, Math.floor(x)), y1 = Math.max(0, Math.floor(y));
        var x2 = Math.min(md.width, Math.ceil(x + width)), y2 = Math.min(md.height, Math.ceil(y + height));
        var a = md.integral;
        return a[y2 * stride + x2] - a[y1 * stride + x2] - a[y2 * stride + x1] + a[y1 * stride + x1];
    };

    PhotoWall.prototype._buildCells = function (cellSize) {
        var b = this.maskData.bounds, cells = [];
        var cols = Math.max(1, Math.ceil(b.width / cellSize));
        var rows = Math.max(1, Math.ceil(b.height / cellSize));
        var cellW = b.width / cols, cellH = b.height / rows;
        var offset = this.placementMode === 'brick';
        for (var row = 0; row < rows; row++) {
            var shift = offset && row % 2 ? -cellW / 2 : 0;
            var extra = offset ? 1 : 0;
            for (var col = 0; col < cols + extra; col++) {
                var x = b.x + col * cellW + shift, y = b.y + row * cellH;
                if (this._rectMaskArea(x, y, cellW, cellH) === 0) continue;
                var jitterX = 0, jitterY = 0;
                if (this.placementMode === 'organic') {
                    var seed = ((row + 1) * 73856093 ^ (col + 1) * 19349663) >>> 0;
                    jitterX = ((seed % 101) / 100 - 0.5) * cellW * 0.22;
                    jitterY = (((seed >> 8) % 101) / 100 - 0.5) * cellH * 0.22;
                }
                cells.push({
                    x: x + cellW / 2 + jitterX,
                    y: y + cellH / 2 + jitterY,
                    baseX: x,
                    baseY: y,
                    width: cellW,
                    height: cellH,
                    size: Math.max(cellW, cellH),
                    row: row,
                    col: col,
                    isLarge: false,
                    boundaryDistance: sampleDistance(this.maskData.distance, this.maskData.width, this.maskData.height,
                        x + cellW / 2, y + cellH / 2)
                });
            }
        }
        return cells;
    };

    PhotoWall.prototype._mergeLargeCells = function (cells, desiredLarge) {
        if (!this.mixedSizes || desiredLarge < 1 || cells.length < 4) return cells;
        var spanRows = this.placementMode === 'brick' ? 1 : 2;
        var spanCols = 2;
        var byPosition = new Map();
        cells.forEach(function (cell) { byPosition.set(cell.row + ':' + cell.col, cell); });
        var bounds = this.maskData.bounds;
        var centerX = bounds.x + bounds.width / 2;
        var centerY = bounds.y + bounds.height / 2;
        var candidates = [];

        cells.forEach(function (cell) {
            var group = [];
            for (var rowOffset = 0; rowOffset < spanRows; rowOffset++) {
                for (var colOffset = 0; colOffset < spanCols; colOffset++) {
                    var member = byPosition.get((cell.row + rowOffset) + ':' + (cell.col + colOffset));
                    if (!member) return;
                    group.push(member);
                }
            }
            var left = Math.min.apply(null, group.map(function (item) { return item.baseX; }));
            var top = Math.min.apply(null, group.map(function (item) { return item.baseY; }));
            var right = Math.max.apply(null, group.map(function (item) { return item.baseX + item.width; }));
            var bottom = Math.max.apply(null, group.map(function (item) { return item.baseY + item.height; }));
            var width = right - left, height = bottom - top;
            var coverage = this._rectMaskArea(left, top, width, height) / Math.max(1, width * height);
            if (coverage < 0.9) return;
            var normalizedDistance = Math.hypot(
                (left + width / 2 - centerX) / Math.max(1, bounds.width),
                (top + height / 2 - centerY) / Math.max(1, bounds.height)
            );
            candidates.push({
                group: group,
                x: left + width / 2,
                y: top + height / 2,
                width: width,
                height: height,
                row: cell.row,
                col: cell.col,
                boundaryDistance: sampleDistance(this.maskData.distance, this.maskData.width, this.maskData.height,
                    left + width / 2, top + height / 2),
                score: coverage * 1.2 +
                    sampleDistance(this.maskData.distance, this.maskData.width, this.maskData.height,
                        left + width / 2, top + height / 2) / Math.max(1, Math.min(width, height)) -
                    normalizedDistance * 0.15
            });
        }, this);

        candidates.sort(function (a, b) { return b.score - a.score; });
        var used = new Set(), largeCells = [];
        for (var i = 0; i < candidates.length && largeCells.length < desiredLarge; i++) {
            var candidate = candidates[i];
            if (candidate.group.some(function (cell) { return used.has(cell); })) continue;
            candidate.group.forEach(function (cell) { used.add(cell); });
            largeCells.push({
                x: candidate.x,
                y: candidate.y,
                baseX: candidate.x - candidate.width / 2,
                baseY: candidate.y - candidate.height / 2,
                width: candidate.width,
                height: candidate.height,
                size: Math.max(candidate.width, candidate.height),
                row: candidate.row,
                col: candidate.col,
                isLarge: true,
                spanRows: spanRows,
                spanCols: spanCols,
                boundaryDistance: candidate.boundaryDistance
            });
        }
        return cells.filter(function (cell) { return !used.has(cell); }).concat(largeCells);
    };

    PhotoWall.prototype._countCells = function (cellSize) {
        var b = this.maskData.bounds, count = 0;
        var cols = Math.max(1, Math.ceil(b.width / cellSize));
        var rows = Math.max(1, Math.ceil(b.height / cellSize));
        var cellW = b.width / cols, cellH = b.height / rows;
        var offset = this.placementMode === 'brick';
        for (var row = 0; row < rows; row++) {
            var shift = offset && row % 2 ? -cellW / 2 : 0;
            var extra = offset ? 1 : 0;
            for (var col = 0; col < cols + extra; col++) {
                var x = b.x + col * cellW + shift;
                var y = b.y + row * cellH;
                if (this._rectMaskArea(x, y, cellW, cellH) > 0) count++;
            }
        }
        return count;
    };

    PhotoWall.prototype._refreshOrderCache = function () {
        this._renderOrder = this.layout.map(function (_, index) { return index; }).sort(function (a, b) {
            return (Number(this.layout[a].zIndex) || 0) - (Number(this.layout[b].zIndex) || 0);
        }.bind(this));
        this._hitOrder = this._renderOrder.slice().reverse();
    };

    PhotoWall.prototype.generateLayout = function (forceRandom, skipAnimation) {
        if (!this.shape || !this.cssWidth) return;
        this.generateMask();
        if (!this.photos.length || !this.maskData.insideCount) {
            this.layout = [];
            this._refreshOrderCache();
            this.render();
            if (this.onLayout) this.onLayout(0, 0);
            return;
        }
        var b = this.maskData.bounds;
        var target = Math.max(1, Math.round(this.photos.length * this.density));
        var desiredLarge = this.mixedSizes && target >= 8 ? Math.max(1, Math.min(80, Math.round(target * 0.1))) : 0;
        var reductionPerLarge = this.placementMode === 'brick' ? 1 : 3;
        var baseTarget = target + desiredLarge * reductionPerLarge;
        var fillRatio = this.maskData.insideCount / Math.max(1, b.width * b.height);
        var estimated = Math.sqrt((b.width * b.height * fillRatio) / baseTarget);
        var low = Math.max(8, estimated * 0.5);
        var high = Math.max(low + 1, estimated * 2);
        var bestSize = estimated, bestCount = this._countCells(estimated), bestDelta = Math.abs(bestCount - baseTarget);
        for (var search = 0; search < 9; search++) {
            var candidateSize = (low + high) / 2;
            var candidateCount = this._countCells(candidateSize);
            var delta = Math.abs(candidateCount - baseTarget);
            if (delta < bestDelta || (delta === bestDelta && candidateCount >= baseTarget && bestCount < baseTarget)) {
                bestSize = candidateSize;
                bestCount = candidateCount;
                bestDelta = delta;
            }
            if (candidateCount > baseTarget) low = candidateSize;
            else high = candidateSize;
        }
        var best = this._buildCells(Math.max(8, bestSize));
        best = this._mergeLargeCells(best, desiredLarge);
        this.layout = this._assignPhotos(best, forceRandom);
        this._refreshOrderCache();
        this.hoveredIndex = -1; this.draggingIndex = -1; this.dragOverIndex = -1;
        if (this.onLayout) this.onLayout(this.layout.length, this.layout.filter(function (item) { return item.isLarge; }).length);
        if (skipAnimation) this.render(); else this._animate();
    };

    PhotoWall.prototype._assignPhotos = function (cells, forceRandom) {
        var order = [], n = this.photos.length;
        for (var i = 0; i < n; i++) order.push(i);
        if (this.smartPlacement && !forceRandom) {
            order = assignPhotosToCells(this.photos, cells, {
                width: this.cssWidth,
                height: this.cssHeight
            });
        } else {
            for (var s = order.length - 1; s > 0; s--) {
                var r = Math.floor(Math.random() * (s + 1));
                var tmp = order[s]; order[s] = order[r]; order[r] = tmp;
            }
        }
        return cells.map(function (cell, index) {
            var photoIndex = order[index % order.length];
            var seed = (((cell.row + 1) * 2654435761) ^ ((cell.col + 1) * 1597334677) ^ (index * 3812015801)) >>> 0;
            var unitRotation = (seed % 2001) / 1000 - 1;
            cell.slotId = 'slot-' + (++this._slotSequence) + '-' + seed.toString(36);
            cell.photoIndex = photoIndex;
            cell.photo = this.photos[photoIndex];
            cell.photoId = cell.photo.id;
            cell.rotation = this.rotationRange ? unitRotation * this.rotationRange : 0;
            cell.zIndex = index;
            return cell;
        }, this);
    };

    PhotoWall.prototype._animate = function () {
        this._animStart = performance.now();
        if (this._animRAF) cancelAnimationFrame(this._animRAF);
        var self = this, duration = Math.min(900, 300 + this.layout.length * 8);
        function frame() {
            var elapsed = performance.now() - self._animStart;
            self.render(elapsed / duration);
            if (elapsed < duration) self._animRAF = requestAnimationFrame(frame);
            else { self._animRAF = null; self.render(); }
        }
        this._animRAF = requestAnimationFrame(frame);
    };

    PhotoWall.prototype.render = function (progress, exportMode) {
        if (!this.cssWidth) return;
        var w = Math.round(this.cssWidth), h = Math.round(this.cssHeight);
        var ctx = this.ctx;
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        if (!this.maskData) return;

        if (!exportMode) {
            ctx.save();
            ctx.globalAlpha = 0.08;
            ctx.drawImage(this.maskData.maskCanvas, 0, 0, w, h);
            ctx.restore();
        }
        if (!this.layout.length) return;

        var layer = this._layerCanvas, lx = this._layerContext;
        var targetWidth = Math.round(w * this.dpr), targetHeight = Math.round(h * this.dpr);
        if (layer.width !== targetWidth || layer.height !== targetHeight) {
            layer.width = targetWidth; layer.height = targetHeight;
        }
        lx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        lx.clearRect(0, 0, w, h);
        lx.globalCompositeOperation = 'source-over';
        lx.globalAlpha = 1;
        var t = progress === undefined ? 1 : Math.max(0, Math.min(1, progress));
        var eased = 1 - Math.pow(1 - t, 3);
        if (this._renderOrder.length !== this.layout.length) this._refreshOrderCache();
        var renderOrder = this._renderOrder;
        for (var orderIndex = 0; orderIndex < renderOrder.length; orderIndex++) {
            var i = renderOrder[orderIndex];
            if (!exportMode && i === this.draggingIndex) continue;
            this._drawPhoto(lx, this.layout[i], !exportMode && i === this.hoveredIndex, eased, !exportMode && i === this.dragOverIndex);
        }
        lx.globalCompositeOperation = 'destination-in';
        lx.drawImage(this.maskData.maskCanvas, 0, 0, w, h);
        ctx.drawImage(layer, 0, 0, w, h);

        if (!exportMode && this.draggingIndex >= 0 && this.pointer) {
            var dragged = this.layout[this.draggingIndex];
            var ghost = Object.assign({}, dragged, { x: this.pointer.x, y: this.pointer.y });
            ctx.save(); ctx.globalAlpha = 0.82;
            this._drawPhoto(ctx, ghost, true, 1, false);
            ctx.restore();
        }
        if (!exportMode) this._drawOutline(ctx);
    };

    PhotoWall.prototype._drawPhoto = function (ctx, item, hovered, scale, dropTarget) {
        var gapScale = Math.max(0.4, 1 - this.gap);
        var width = item.width * gapScale * scale, height = item.height * gapScale * scale;
        if (this.photoShape !== 'square') { width *= 1.16; height *= 1.16; }
        var x = item.x, y = item.y, img = item.photo.img;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate((Number(item.rotation) || 0) * Math.PI / 180);
        if (hovered || dropTarget) {
            ctx.shadowColor = dropTarget ? 'rgba(96,225,190,.9)' : 'rgba(124,108,240,.75)';
            ctx.shadowBlur = 16;
        }
        this._photoPath(ctx, 0, 0, width, height);
        ctx.clip();
        var imageAspect = img.naturalWidth / img.naturalHeight, boxAspect = width / height;
        var dw, dh;
        if (imageAspect > boxAspect) { dh = height; dw = height * imageAspect; }
        else { dw = width; dh = width / imageAspect; }
        var focusX = Number.isFinite(item.photo.focusX) ? item.photo.focusX : 0.5;
        var focusY = Number.isFinite(item.photo.focusY) ? item.photo.focusY : 0.5;
        var drawX = Math.max(width / 2 - dw, Math.min(-width / 2, -dw * focusX));
        var drawY = Math.max(height / 2 - dh, Math.min(-height / 2, -dh * focusY));
        ctx.drawImage(img, drawX, drawY, dw, dh);
        if (hovered || dropTarget) {
            ctx.shadowColor = 'transparent'; ctx.lineWidth = 2;
            ctx.strokeStyle = dropTarget ? '#60e1be' : '#a99cff';
            this._photoPath(ctx, 0, 0, width, height); ctx.stroke();
        }
        ctx.restore();
    };

    PhotoWall.prototype._photoPath = function (ctx, x, y, width, height) {
        var rx = width / 2, ry = height / 2;
        ctx.beginPath();
        if (this.photoShape === 'circle') ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
        else if (this.photoShape === 'diamond') {
            ctx.moveTo(x, y - ry);
            ctx.lineTo(x + rx, y);
            ctx.lineTo(x, y + ry);
            ctx.lineTo(x - rx, y);
            ctx.closePath();
        }
        else if (this.photoShape === 'hexagon') {
            for (var i = 0; i < 6; i++) {
                var angle = Math.PI / 3 * i - Math.PI / 6;
                var px = x + rx * Math.cos(angle), py = y + ry * Math.sin(angle);
                if (!i) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.closePath();
        } else if (this.photoShape === 'heart') {
            ctx.moveTo(x, y + ry * .82);
            ctx.bezierCurveTo(x - rx * 1.25, y + ry * .1, x - rx, y - ry, x, y - ry * .35);
            ctx.bezierCurveTo(x + rx, y - ry, x + rx * 1.25, y + ry * .1, x, y + ry * .82);
            ctx.closePath();
        } else {
            var radius = Math.min(12, width * .1, height * .1);
            ctx.roundRect(x - rx, y - ry, width, height, radius);
        }
    };

    PhotoWall.prototype._drawOutline = function (ctx) {
        if (!this.shape || !this.maskData || this.shape.maskCanvas) return;
        var md = this.maskData;
        ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.32)'; ctx.lineWidth = 1.2;
        ctx.translate(md.offX, md.offY); ctx.scale(md.scale, md.scale);
        for (var i = 0; i < this.shape.paths.length; i++) ctx.stroke(new Path2D(this.shape.paths[i]));
        ctx.restore();
    };

    PhotoWall.prototype.getExportBounds = function () {
        if (!this.maskData || !this.maskData.bounds) {
            return { x: 0, y: 0, width: Math.round(this.cssWidth), height: Math.round(this.cssHeight) };
        }
        var bounds = this.maskData.bounds;
        var padding = Math.max(2, Math.min(8, Math.min(bounds.width, bounds.height) * 0.01));
        var left = Math.max(0, Math.floor(bounds.x - padding));
        var top = Math.max(0, Math.floor(bounds.y - padding));
        var right = Math.min(Math.round(this.cssWidth), Math.ceil(bounds.x + bounds.width + padding));
        var bottom = Math.min(Math.round(this.cssHeight), Math.ceil(bounds.y + bounds.height + padding));
        return {
            x: left,
            y: top,
            width: Math.max(1, right - left),
            height: Math.max(1, bottom - top)
        };
    };

    PhotoWall.prototype.getExportFrame = function (aspectRatio) {
        var bounds = this.getExportBounds();
        var ratios = { '3:4': 3 / 4, '9:16': 9 / 16 };
        var targetRatio = ratios[aspectRatio];
        if (!targetRatio) return bounds;

        var width = bounds.width;
        var height = bounds.height;
        if (width / height > targetRatio) height = width / targetRatio;
        else width = height * targetRatio;
        return {
            x: bounds.x - (width - bounds.width) / 2,
            y: bounds.y - (height - bounds.height) / 2,
            width: width,
            height: height
        };
    };

    PhotoWall.prototype.getExportDimensions = function (scale, aspectRatio) {
        scale = Math.max(0.1, Math.min(3, Number(scale) || 2));
        var bounds = this.getExportFrame(aspectRatio);
        var ratioUnits = { '3:4': [3, 4], '9:16': [9, 16] }[aspectRatio];
        if (ratioUnits) {
            var unit = Math.ceil(Math.max(
                bounds.width * scale / ratioUnits[0],
                bounds.height * scale / ratioUnits[1]
            ));
            return { width: unit * ratioUnits[0], height: unit * ratioUnits[1] };
        }
        return {
            width: Math.max(1, Math.round(bounds.width * scale)),
            height: Math.max(1, Math.round(bounds.height * scale))
        };
    };

    PhotoWall.prototype.createExportCanvas = function (options) {
        options = options || {};
        var scale = Math.max(0.1, Math.min(3, Number(options.scale) || 2));
        var background = options.background === undefined ? '#ffffff' : options.background;
        if (!this.cssWidth || !this.cssHeight || !this.maskData || !this.maskData.maskCanvas || !this.layout.length) {
            var empty = document.createElement('canvas');
            empty.width = 1;
            empty.height = 1;
            var emptyContext = empty.getContext('2d');
            if (emptyContext && background && background !== 'transparent') {
                emptyContext.fillStyle = background;
                emptyContext.fillRect(0, 0, 1, 1);
            }
            return empty;
        }
        var bounds = this.getExportFrame(options.aspectRatio);
        var dimensions = this.getExportDimensions(scale, options.aspectRatio);
        var frameWidth = dimensions.width / scale;
        var frameHeight = dimensions.height / scale;
        bounds.x -= (frameWidth - bounds.width) / 2;
        bounds.y -= (frameHeight - bounds.height) / 2;
        bounds.width = frameWidth;
        bounds.height = frameHeight;
        var out = document.createElement('canvas');
        out.width = dimensions.width;
        out.height = dimensions.height;
        var ox = out.getContext('2d');
        if (!ox) return out;
        ox.imageSmoothingEnabled = true;
        ox.imageSmoothingQuality = 'high';

        // Render from the original photos at the requested scale. Scaling the
        // visible editor canvas made 2×/3× exports larger, but not truly sharper.
        ox.setTransform(scale, 0, 0, scale, -bounds.x * scale, -bounds.y * scale);
        if (this._renderOrder.length !== this.layout.length) this._refreshOrderCache();
        for (var i = 0; i < this._renderOrder.length; i++) {
            this._drawPhoto(ox, this.layout[this._renderOrder[i]], false, 1, false);
        }
        ox.globalCompositeOperation = 'destination-in';
        ox.drawImage(this.maskData.maskCanvas, 0, 0, this.cssWidth, this.cssHeight);
        ox.setTransform(1, 0, 0, 1, 0, 0);

        if (background && background !== 'transparent') {
            ox.globalCompositeOperation = 'destination-over';
            ox.fillStyle = background;
            ox.fillRect(0, 0, out.width, out.height);
        }
        ox.globalCompositeOperation = 'source-over';
        return out;
    };

    PhotoWall.prototype.exportPNG = function (scale) {
        return this.createExportCanvas({ scale: scale, background: '#ffffff' }).toDataURL('image/png');
    };

    PhotoWall.prototype.getArrangement = function () {
        return this.layout.map(function (item) { return item.photoId || (item.photo && item.photo.id) || item.photoIndex; });
    };

    PhotoWall.prototype.setArrangement = function (arrangement) {
        if (!arrangement || !arrangement.length || !this.photos.length) return;
        var photoIndexById = new Map();
        this.photos.forEach(function (photo, index) { photoIndexById.set(photo.id, index); });
        for (var i = 0; i < this.layout.length; i++) {
            var reference = arrangement[i % arrangement.length];
            var photoIndex = typeof reference === 'string' ? photoIndexById.get(reference) : reference;
            if (!Number.isInteger(photoIndex) || photoIndex < 0 || photoIndex >= this.photos.length) continue;
            this.layout[i].photoIndex = photoIndex;
            this.layout[i].photo = this.photos[photoIndex];
            this.layout[i].photoId = this.photos[photoIndex].id;
        }
        this.render();
    };

    PhotoWall.prototype.getLayoutSnapshot = function () {
        var width = Math.max(1, this.cssWidth || 1), height = Math.max(1, this.cssHeight || 1);
        return {
            canvasWidth: width,
            canvasHeight: height,
            items: this.layout.map(function (item) {
                return {
                    slotId: item.slotId,
                    photoId: item.photoId || (item.photo && item.photo.id),
                    x: item.x / width,
                    y: item.y / height,
                    width: item.width / width,
                    height: item.height / height,
                    rotation: Number(item.rotation) || 0,
                    zIndex: Number(item.zIndex) || 0,
                    row: item.row,
                    col: item.col,
                    isLarge: item.isLarge === true,
                    spanRows: item.spanRows,
                    spanCols: item.spanCols,
                    boundaryDistance: item.boundaryDistance
                };
            })
        };
    };

    PhotoWall.prototype.setLayoutSnapshot = function (snapshot) {
        if (!snapshot || !Array.isArray(snapshot.items) || !this.photos.length) return false;
        var width = Math.max(1, this.cssWidth || snapshot.canvasWidth || 1);
        var height = Math.max(1, this.cssHeight || snapshot.canvasHeight || 1);
        var photoIndexById = new Map();
        this.photos.forEach(function (photo, index) { photoIndexById.set(photo.id, index); });
        var restored = [];
        snapshot.items.forEach(function (saved, index) {
            var photoIndex = photoIndexById.get(saved.photoId);
            if (photoIndex === undefined) return;
            var normalizedX = Number(saved.x), normalizedY = Number(saved.y);
            var normalizedWidth = Number(saved.width), normalizedHeight = Number(saved.height);
            if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY) ||
                !Number.isFinite(normalizedWidth) || !Number.isFinite(normalizedHeight) ||
                normalizedX < -1 || normalizedX > 2 || normalizedY < -1 || normalizedY > 2 ||
                normalizedWidth <= 0 || normalizedWidth > 2 || normalizedHeight <= 0 || normalizedHeight > 2) return;
            var item = {
                slotId: saved.slotId || 'slot-restored-' + index,
                photoId: saved.photoId,
                photoIndex: photoIndex,
                photo: this.photos[photoIndex],
                x: normalizedX * width,
                y: normalizedY * height,
                width: Math.max(1, normalizedWidth * width),
                height: Math.max(1, normalizedHeight * height),
                rotation: Math.max(-360, Math.min(360, Number(saved.rotation) || 0)),
                zIndex: Math.max(-10000, Math.min(10000, Number(saved.zIndex) || 0)),
                row: Number(saved.row) || 0,
                col: Number(saved.col) || 0,
                isLarge: saved.isLarge === true,
                spanRows: Number(saved.spanRows) || 1,
                spanCols: Number(saved.spanCols) || 1,
                boundaryDistance: Math.max(0, Number(saved.boundaryDistance) || 0)
            };
            item.size = Math.max(item.width, item.height);
            restored.push(item);
        }, this);
        if (!restored.length) return false;
        this.layout = restored;
        this._refreshOrderCache();
        this.hoveredIndex = -1;
        this.draggingIndex = -1;
        this.dragOverIndex = -1;
        if (this.onLayout) this.onLayout(this.layout.length, this.layout.filter(function (item) { return item.isLarge; }).length);
        this.render();
        return true;
    };

    PhotoWall.prototype._eventPoint = function (e) {
        var rect = this.canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    PhotoWall.prototype.getPhotoAt = function (x, y) {
        if (!this.maskData) return -1;
        var mx = Math.round(x), my = Math.round(y);
        if (mx < 0 || my < 0 || mx >= this.maskData.width || my >= this.maskData.height ||
            !this.maskData.mask[my * this.maskData.width + mx]) return -1;
        if (this._hitOrder.length !== this.layout.length) this._refreshOrderCache();
        var hitOrder = this._hitOrder;
        for (var orderIndex = 0; orderIndex < hitOrder.length; orderIndex++) {
            var i = hitOrder[orderIndex];
            var item = this.layout[i];
            var angle = -(Number(item.rotation) || 0) * Math.PI / 180;
            var dx = x - item.x, dy = y - item.y;
            var localX = dx * Math.cos(angle) - dy * Math.sin(angle);
            var localY = dx * Math.sin(angle) + dy * Math.cos(angle);
            var gapScale = Math.max(0.4, 1 - this.gap);
            var hitWidth = item.width * gapScale, hitHeight = item.height * gapScale;
            if (this.photoShape !== 'square') { hitWidth *= 1.16; hitHeight *= 1.16; }
            if (Math.abs(localX) <= hitWidth / 2 && Math.abs(localY) <= hitHeight / 2) return i;
        }
        return -1;
    };
    PhotoWall.prototype._swapAssignments = function (a, b) {
        if (a < 0 || b < 0 || a === b) return;
        var photo = this.layout[a].photo, photoIndex = this.layout[a].photoIndex;
        this.layout[a].photo = this.layout[b].photo; this.layout[a].photoIndex = this.layout[b].photoIndex;
        this.layout[b].photo = photo; this.layout[b].photoIndex = photoIndex;
        this.layout[a].photoId = this.layout[a].photo.id;
        this.layout[b].photoId = this.layout[b].photo.id;
    };

    PhotoWall.prototype._bindEvents = function () {
        var self = this;
        this.canvas.addEventListener('pointerdown', function (e) {
            var p = self._eventPoint(e), idx = self.getPhotoAt(p.x, p.y);
            if (idx < 0) return;
            self._pointerDown = { x: p.x, y: p.y, index: idx, time: Date.now() };
            self.canvas.setPointerCapture(e.pointerId);
        });
        this.canvas.addEventListener('pointermove', function (e) {
            var p = self._eventPoint(e);
            if (self._pointerDown) {
                var moved = Math.hypot(p.x - self._pointerDown.x, p.y - self._pointerDown.y);
                if (moved > 5 && self.draggingIndex < 0) self.draggingIndex = self._pointerDown.index;
                if (self.draggingIndex >= 0) {
                    self.pointer = p;
                    var over = self.getPhotoAt(p.x, p.y);
                    self.dragOverIndex = over === self.draggingIndex ? -1 : over;
                    self.canvas.style.cursor = 'grabbing'; self.render(); return;
                }
            }
            var hover = self.getPhotoAt(p.x, p.y);
            if (hover !== self.hoveredIndex) {
                self.hoveredIndex = hover; self.canvas.style.cursor = hover >= 0 ? 'grab' : 'default';
                if (!self._animRAF) self.render();
            }
        });
        function finish(e) {
            if (!self._pointerDown) return;
            var source = self._pointerDown.index, target = self.dragOverIndex;
            var wasDrag = self.draggingIndex >= 0;
            if (wasDrag && target >= 0) {
                if (self.onBeforeSwap) self.onBeforeSwap(source, target);
                self._swapAssignments(source, target);
                if (self.onSwap) self.onSwap(source, target);
            } else if (!wasDrag && self.onPhotoClick) self.onPhotoClick(self.layout[source], source);
            self._pointerDown = null; self.draggingIndex = -1; self.dragOverIndex = -1; self.pointer = null;
            self.canvas.style.cursor = 'default'; self.render();
            try { self.canvas.releasePointerCapture(e.pointerId); } catch (ignore) {}
        }
        this.canvas.addEventListener('pointerup', finish);
        this.canvas.addEventListener('pointercancel', finish);
        this.canvas.addEventListener('pointerleave', function () {
            if (!self._pointerDown) { self.hoveredIndex = -1; self.canvas.style.cursor = 'default'; self.render(); }
        });
    };

export { PhotoWall };
