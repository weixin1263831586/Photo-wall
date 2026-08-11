/**
 * PhotoWall — shape-aware mosaic engine.
 * Photos are tiled across the silhouette bounds and the final composition is
 * clipped by one shared mask. This guarantees that no photo pixel can escape
 * the selected outline while boundary cells still cover it completely.
 */
(function (global) {
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
        this.density = 1;
        this.gap = 0;
        this.placementMode = 'grid';
        this.photoShape = 'square';
        this.smartPlacement = true;
        this.hoveredIndex = -1;
        this.draggingIndex = -1;
        this.dragOverIndex = -1;
        this.pointer = null;
        this.onPhotoClick = null;
        this.onSwap = null;
        this.onLayout = null;
        this._animStart = 0;
        this._animRAF = null;
        this._pointerDown = null;
        this._bindEvents();
    }

    PhotoWall.analyzePhoto = function (img) {
        var size = 24;
        var c = document.createElement('canvas');
        c.width = size;
        c.height = size;
        var cx = c.getContext('2d', { willReadFrequently: true });
        cx.drawImage(img, 0, 0, size, size);
        var data = cx.getImageData(0, 0, size, size).data;
        var r = 0, g = 0, b = 0, n = size * size;
        for (var i = 0; i < n; i++) {
            r += data[i * 4];
            g += data[i * 4 + 1];
            b += data[i * 4 + 2];
        }
        r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
        var max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min, hue = 0;
        if (delta) {
            if (max === r) hue = 60 * (((g - b) / delta) % 6);
            else if (max === g) hue = 60 * ((b - r) / delta + 2);
            else hue = 60 * ((r - g) / delta + 4);
        }
        if (hue < 0) hue += 360;
        return { r: r, g: g, b: b, brightness: (0.299 * r + 0.587 * g + 0.114 * b) / 255, hue: hue };
    };

    PhotoWall.prototype.resize = function () {
        var rect = this.canvas.parentElement.getBoundingClientRect();
        this.cssWidth = Math.max(100, rect.width);
        this.cssHeight = Math.max(100, rect.height);
        this.dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.canvas.width = Math.round(this.cssWidth * this.dpr);
        this.canvas.height = Math.round(this.cssHeight * this.dpr);
        this.canvas.style.width = this.cssWidth + 'px';
        this.canvas.style.height = this.cssHeight + 'px';
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        if (this.shape) this.generateLayout(false, true);
    };

    PhotoWall.prototype.setShape = function (key) {
        this.shapeKey = key;
        this.shape = global.Shapes[key];
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
                var inside = imageData[pixel + 3] > 127 && imageData[pixel] > 127 ? 1 : 0;
                mask[y * w + x] = inside;
                cleanMask.data[pixel] = 255;
                cleanMask.data[pixel + 1] = 255;
                cleanMask.data[pixel + 2] = 255;
                cleanMask.data[pixel + 3] = inside ? 255 : 0;
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
            mask: mask, maskCanvas: maskCanvas, integral: integral, width: w, height: h,
            bounds: { x: minX, y: minY, width: Math.max(1, maxX - minX + 1), height: Math.max(1, maxY - minY + 1) },
            offX: offX, offY: offY, drawW: drawW, drawH: drawH, scale: scale, insideCount: count
        };
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
                cells.push({ x: x + cellW / 2 + jitterX, y: y + cellH / 2 + jitterY, width: cellW, height: cellH, size: Math.max(cellW, cellH), row: row, col: col });
            }
        }
        return cells;
    };

    PhotoWall.prototype.generateLayout = function (forceRandom, skipAnimation) {
        if (!this.shape || !this.cssWidth) return;
        this.generateMask();
        if (!this.photos.length || !this.maskData.insideCount) {
            this.layout = [];
            this.render();
            if (this.onLayout) this.onLayout(0);
            return;
        }
        var b = this.maskData.bounds;
        var target = Math.max(1, Math.round(this.photos.length * this.density));
        var fillRatio = this.maskData.insideCount / Math.max(1, b.width * b.height);
        var estimated = Math.sqrt((b.width * b.height * fillRatio) / target);
        var best = [], bestDelta = Infinity;
        for (var factor = 0.55; factor <= 1.75; factor += 0.05) {
            var candidate = this._buildCells(Math.max(8, estimated * factor));
            var delta = Math.abs(candidate.length - target);
            if (delta < bestDelta || (delta === bestDelta && candidate.length >= target)) {
                best = candidate; bestDelta = delta;
            }
        }
        if (!best.length) best = this._buildCells(Math.max(8, estimated));
        this.layout = this._assignPhotos(best, forceRandom);
        this.hoveredIndex = -1; this.draggingIndex = -1; this.dragOverIndex = -1;
        if (this.onLayout) this.onLayout(this.layout.length);
        if (skipAnimation) this.render(); else this._animate();
    };

    PhotoWall.prototype._assignPhotos = function (cells, forceRandom) {
        var order = [], n = this.photos.length;
        for (var i = 0; i < n; i++) order.push(i);
        if (this.smartPlacement && !forceRandom) {
            order.sort(function (a, b) { return this.photos[a].hue - this.photos[b].hue; }.bind(this));
            cells.sort(function (a, b) {
                var bandA = Math.floor(a.y / Math.max(1, a.height));
                var bandB = Math.floor(b.y / Math.max(1, b.height));
                return bandA === bandB ? a.x - b.x : a.y - b.y;
            });
        } else {
            for (var s = order.length - 1; s > 0; s--) {
                var r = Math.floor(Math.random() * (s + 1));
                var tmp = order[s]; order[s] = order[r]; order[r] = tmp;
            }
        }
        return cells.map(function (cell, index) {
            var photoIndex = order[index % n];
            cell.photoIndex = photoIndex;
            cell.photo = this.photos[photoIndex];
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

    PhotoWall.prototype.render = function (progress) {
        if (!this.cssWidth) return;
        var w = Math.round(this.cssWidth), h = Math.round(this.cssHeight);
        var ctx = this.ctx;
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        if (!this.maskData) return;

        ctx.save();
        ctx.globalAlpha = 0.08;
        ctx.drawImage(this.maskData.maskCanvas, 0, 0, w, h);
        ctx.restore();
        if (!this.layout.length) return;

        var layer = document.createElement('canvas'); layer.width = w; layer.height = h;
        var lx = layer.getContext('2d');
        var t = progress === undefined ? 1 : Math.max(0, Math.min(1, progress));
        var eased = 1 - Math.pow(1 - t, 3);
        for (var i = 0; i < this.layout.length; i++) {
            if (i === this.draggingIndex) continue;
            this._drawPhoto(lx, this.layout[i], i === this.hoveredIndex, eased, i === this.dragOverIndex);
        }
        lx.globalCompositeOperation = 'destination-in';
        lx.drawImage(this.maskData.maskCanvas, 0, 0);
        ctx.drawImage(layer, 0, 0, w, h);

        if (this.draggingIndex >= 0 && this.pointer) {
            var dragged = this.layout[this.draggingIndex];
            var ghost = Object.assign({}, dragged, { x: this.pointer.x, y: this.pointer.y });
            ctx.save(); ctx.globalAlpha = 0.82;
            this._drawPhoto(ctx, ghost, true, 1, false);
            ctx.restore();
        }
        this._drawOutline(ctx);
    };

    PhotoWall.prototype._drawPhoto = function (ctx, item, hovered, scale, dropTarget) {
        var gapScale = Math.max(0.4, 1 - this.gap);
        var width = item.width * gapScale * scale, height = item.height * gapScale * scale;
        if (this.photoShape !== 'square') { width *= 1.16; height *= 1.16; }
        var x = item.x, y = item.y, img = item.photo.img;
        ctx.save();
        if (hovered || dropTarget) {
            ctx.shadowColor = dropTarget ? 'rgba(96,225,190,.9)' : 'rgba(124,108,240,.75)';
            ctx.shadowBlur = 16;
        }
        this._photoPath(ctx, x, y, width, height);
        ctx.clip();
        var imageAspect = img.naturalWidth / img.naturalHeight, boxAspect = width / height;
        var dw, dh;
        if (imageAspect > boxAspect) { dh = height; dw = height * imageAspect; }
        else { dw = width; dh = width / imageAspect; }
        ctx.drawImage(img, x - dw / 2, y - dh / 2, dw, dh);
        if (hovered || dropTarget) {
            ctx.shadowColor = 'transparent'; ctx.lineWidth = 2;
            ctx.strokeStyle = dropTarget ? '#60e1be' : '#a99cff';
            this._photoPath(ctx, x, y, width, height); ctx.stroke();
        }
        ctx.restore();
    };

    PhotoWall.prototype._photoPath = function (ctx, x, y, width, height) {
        var rx = width / 2, ry = height / 2;
        ctx.beginPath();
        if (this.photoShape === 'circle') ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
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

    PhotoWall.prototype.exportPNG = function (scale) {
        scale = Math.max(1, Math.min(4, scale || 2));
        this.render();
        var out = document.createElement('canvas');
        out.width = Math.round(this.cssWidth * scale); out.height = Math.round(this.cssHeight * scale);
        var ox = out.getContext('2d');
        // The editor canvas is transparent outside the silhouette. Fill the
        // exported bitmap first so image viewers do not show a checkerboard.
        ox.fillStyle = '#ffffff';
        ox.fillRect(0, 0, out.width, out.height);
        ox.imageSmoothingEnabled = true;
        ox.imageSmoothingQuality = 'high';
        ox.drawImage(this.canvas, 0, 0, out.width, out.height);
        return out.toDataURL('image/png');
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
        for (var i = this.layout.length - 1; i >= 0; i--) {
            var item = this.layout[i];
            if (Math.abs(x - item.x) <= item.width / 2 && Math.abs(y - item.y) <= item.height / 2) return i;
        }
        return -1;
    };
    PhotoWall.prototype._swapAssignments = function (a, b) {
        if (a < 0 || b < 0 || a === b) return;
        var photo = this.layout[a].photo, photoIndex = this.layout[a].photoIndex;
        this.layout[a].photo = this.layout[b].photo; this.layout[a].photoIndex = this.layout[b].photoIndex;
        this.layout[b].photo = photo; this.layout[b].photoIndex = photoIndex;
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

    global.PhotoWall = PhotoWall;
})(window);
