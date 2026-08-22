/**
 * PhotoWall — shape-aware mosaic engine.
 * Photos are tiled across the silhouette bounds and the final composition is
 * clipped by one shared mask. This guarantees that no photo pixel can escape
 * the selected outline while boundary cells still cover it completely.
 */
import { Shapes } from './shapes.js';
import { computeDistanceTransform, sampleDistance } from './mask/DistanceTransform.js';
import { assignPhotosToCells } from './layout/SmartPlacement.js';
import { createSeededRandom, mixSeed, normalizeSeed } from './layout/SeededRandom.js';
import {
    addRoundedRectPath,
    drawPhotoCover,
    photoImageDimensions,
    SLOT_LOCAL_OFFSET_LIMIT,
    SLOT_LOCAL_ZOOM_MAX,
    SLOT_LOCAL_ZOOM_MIN
} from './image/PhotoTransform.js';
import { computeOptimalPlacement } from './image/AutoCropOptimizer.js';
import { drawOverlays, getOverlayAt } from './overlay/OverlayRenderer.js';

'use strict';

    function PhotoWall(canvas, options) {
        options = options || {};
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.maxDevicePixelRatio = Math.max(1, Math.min(2, Number(options.maxDevicePixelRatio) || 2));
        this.assetManager = options.assetManager || null;
        this.videoPlayer = options.videoPlayer || null;
        this.dpr = Math.min(window.devicePixelRatio || 1, this.maxDevicePixelRatio);
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
        this.matrixColumns = 0;
        this.photoShape = 'square';
        this.smartPlacement = true;
        this.mixedSizes = true;
        this.rotationRange = 0;
        this.layoutSeed = normalizeSeed(options.layoutSeed);
        this.overlays = [];
        this.selectedOverlayId = null;
        this._overlayPointerDown = null;
        this.onOverlaySelect = null;
        this.onBeforeOverlayMove = null;
        this.onOverlayMove = null;
        this.hoveredIndex = -1;
        this.draggingIndex = -1;
        this.dragOverIndex = -1;
        this.interactionMode = 'swap';
        this.localAdjustIndex = -1;
        this.localAdjustPreviewIndex = -1;
        this.pointer = null;
        this.onPhotoClick = null;
        this.onBeforeSwap = null;
        this.onSwap = null;
        this.onBeforeLocalAdjust = null;
        this.onLocalAdjust = null;
        this.onLocalAdjustSelect = null;
        this.onLayout = null;
        this._animStart = 0;
        this._animRAF = null;
        this._pointerDown = null;
        this._slotSequence = 0;
        this._renderRevision = 0;
        this._cachedLayerRevision = -1;
        this._layerCanvas = document.createElement('canvas');
        this._layerContext = this._layerCanvas.getContext('2d');
        this._stagingCanvas = document.createElement('canvas');
        this._stagingContext = this._stagingCanvas.getContext('2d');
        this._previousLayerCanvas = document.createElement('canvas');
        this._previousLayerContext = this._previousLayerCanvas.getContext('2d');
        this._composeRevision = -1;
        this._composePromise = null;
        this._hasComposedLayer = false;
        this._composeRetryTimer = null;
        this._composeRetryCount = 0;
        this._maxComposeRetries = 2;
        this._transitionPendingDuration = 0;
        this._transitionProgress = 1;
        this._transitionRAF = null;
        this._playbackFrame = null;
        this._videoLoopToken = null;
        this._autoCropCache = new Map();
        this._bindEvents();
    }

    PhotoWall.prototype._invalidateRenderCache = function () {
        this._renderRevision++;
        this._cachedLayerRevision = -1;
        this._composeRevision = -1;
        this.localAdjustPreviewIndex = -1;
        if (this._autoCropCache) this._autoCropCache.clear();
        if (this._composeRetryTimer) {
            clearTimeout(this._composeRetryTimer);
            this._composeRetryTimer = null;
        }
        this._composeRetryCount = 0;
    };

    PhotoWall.prototype.resize = function () {
        var previousLayout = this.layout.length ? this.getLayoutSnapshot() : null;
        var rect = this.canvas.parentElement.getBoundingClientRect();
        this.cssWidth = Math.max(100, rect.width);
        this.cssHeight = Math.max(100, rect.height);
        this.dpr = Math.min(window.devicePixelRatio || 1, this.maxDevicePixelRatio);
        this.canvas.width = Math.round(this.cssWidth * this.dpr);
        this.canvas.height = Math.round(this.cssHeight * this.dpr);
        this.canvas.style.width = this.cssWidth + 'px';
        this.canvas.style.height = this.cssHeight + 'px';
        this._layerCanvas.width = this.canvas.width;
        this._layerCanvas.height = this.canvas.height;
        this._stagingCanvas.width = this.canvas.width;
        this._stagingCanvas.height = this.canvas.height;
        this._previousLayerCanvas.width = this.canvas.width;
        this._previousLayerCanvas.height = this.canvas.height;
        this._cancelLayerTransition();
        this._hasComposedLayer = false;
        this._invalidateRenderCache();
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
        if (this.videoPlayer) this.videoPlayer.sync(this.photos);
        if (this.shape) this.generateLayout();
    };
    PhotoWall.prototype.setInteractionMode = function (mode) {
        this.interactionMode = mode === 'adjust' ? 'adjust' : 'swap';
        this._pointerDown = null;
        this.draggingIndex = -1;
        this.dragOverIndex = -1;
        this.localAdjustIndex = -1;
        this.localAdjustPreviewIndex = -1;
        this.pointer = null;
        if (this.onLocalAdjustSelect) this.onLocalAdjustSelect(null, -1);
        this.canvas.style.cursor = this.interactionMode === 'adjust' ? 'move' : 'default';
        this.render();
    };
    PhotoWall.prototype.selectLocalAdjust = function (index) {
        index = Number.isInteger(index) && index >= 0 && index < this.layout.length ? index : -1;
        if (this.interactionMode !== 'adjust') index = -1;
        if (index === this.localAdjustIndex) return this.layout[index] || null;
        this.localAdjustIndex = index;
        var item = index >= 0 ? this.layout[index] : null;
        if (this.onLocalAdjustSelect) this.onLocalAdjustSelect(item, index);
        this.render();
        return item;
    };
    PhotoWall.prototype.setLocalZoom = function (index, value) {
        var item = Number.isInteger(index) ? this.layout[index] : null;
        if (!item) return false;
        var zoom = Math.max(SLOT_LOCAL_ZOOM_MIN,
            Math.min(SLOT_LOCAL_ZOOM_MAX, Number(value) || SLOT_LOCAL_ZOOM_MIN));
        if (Math.abs(zoom - (Number(item.localZoom) || SLOT_LOCAL_ZOOM_MIN)) < 0.0001) return false;
        item.localZoom = zoom;
        this._invalidateRenderCache();
        this.localAdjustPreviewIndex = index;
        this.render();
        return true;
    };
    PhotoWall.prototype.resetLocalAdjust = function (index) {
        var item = Number.isInteger(index) ? this.layout[index] : null;
        if (!item) return false;
        var changed = Math.abs(Number(item.localOffsetX) || 0) > 0.0001 ||
            Math.abs(Number(item.localOffsetY) || 0) > 0.0001 ||
            Math.abs((Number(item.localZoom) || SLOT_LOCAL_ZOOM_MIN) - SLOT_LOCAL_ZOOM_MIN) > 0.0001;
        if (!changed) return false;
        item.localOffsetX = 0;
        item.localOffsetY = 0;
        item.localZoom = SLOT_LOCAL_ZOOM_MIN;
        this._invalidateRenderCache();
        this.localAdjustPreviewIndex = index;
        this.render();
        return true;
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
        if (mode !== 'grid') this.matrixColumns = 0;
        if (this.shape) this.generateLayout();
    };
    PhotoWall.prototype.setMatrixColumns = function (columns) {
        columns = Number(columns) || 0;
        this.matrixColumns = [2, 3, 4, 5, 6, 8].indexOf(columns) >= 0 ? columns : 0;
        if (this.matrixColumns) {
            this.placementMode = 'grid';
            this.mixedSizes = false;
        }
        if (this.shape) this.generateLayout();
    };
    PhotoWall.prototype.setPhotoShape = function (shape) {
        this.photoShape = shape;
        this._invalidateRenderCache();
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
    PhotoWall.prototype.refreshPhotoRendering = function () {
        this._invalidateRenderCache();
        this.render();
    };
    PhotoWall.prototype.setOverlays = function (overlays) {
        this.overlays = Array.isArray(overlays) ? overlays : [];
        this.render();
    };
    PhotoWall.prototype.selectOverlay = function (id) {
        this.selectedOverlayId = id || null;
        this.render();
    };
    PhotoWall.prototype.shuffle = function () {
        this.nextLayoutVariant();
    };
    PhotoWall.prototype.randomizeAssignments = function (seed, transitionDuration) {
        if (this.layout.length < 2) return false;
        seed = normalizeSeed(seed === undefined ? this.layoutSeed + 1 : seed);
        this.layoutSeed = seed;
        var random = createSeededRandom(seed);
        var assignments = this.layout.map(function (item) {
            return { photo: item.photo, photoIndex: item.photoIndex, photoId: item.photoId };
        });
        for (var index = assignments.length - 1; index > 0; index--) {
            var target = Math.floor(random() * (index + 1));
            var temporary = assignments[index];
            assignments[index] = assignments[target];
            assignments[target] = temporary;
        }
        var unchanged = assignments.every(function (assignment, index) {
            return assignment.photoId === this.layout[index].photoId;
        }, this);
        if (unchanged) assignments.push(assignments.shift());

        this._capturePreviousLayer(Math.max(0, Number(transitionDuration) || 0));
        this.layout.forEach(function (item, index) {
            item.photo = assignments[index].photo;
            item.photoIndex = assignments[index].photoIndex;
            item.photoId = assignments[index].photoId;
        });
        this._invalidateRenderCache();
        this.render();
        return true;
    };
    PhotoWall.prototype.nextLayoutVariant = function () {
        this.layoutSeed = normalizeSeed(this.layoutSeed + 1);
        if (this.shape) this.generateLayout();
        return this.layoutSeed;
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

    PhotoWall.prototype._visibleMaskCentroid = function (x, y, width, height) {
        var md = this.maskData;
        if (!md || !md.mask) return { x: 0.5, y: 0.5 };
        var x1 = Math.max(0, Math.floor(x)), y1 = Math.max(0, Math.floor(y));
        var x2 = Math.min(md.width, Math.ceil(x + width)), y2 = Math.min(md.height, Math.ceil(y + height));
        var count = 0, sumX = 0, sumY = 0;
        for (var py = y1; py < y2; py++) {
            for (var px = x1; px < x2; px++) {
                if (!md.mask[py * md.width + px]) continue;
                count++;
                sumX += px + 0.5;
                sumY += py + 0.5;
            }
        }
        return count ? {
            x: Math.max(0.05, Math.min(0.95, (sumX / count - x) / Math.max(1, width))),
            y: Math.max(0.05, Math.min(0.95, (sumY / count - y) / Math.max(1, height)))
        } : { x: 0.5, y: 0.5 };
    };

    /**
     * Return the part of a rotated boundary slot that can actually survive
     * the final silhouette clip. Photo panning only needs to keep this area
     * covered; requiring the invisible remainder of the rectangular slot to
     * stay covered made thin stars, aircraft wings and lettering feel locked.
     *
     * The rectangle test is intentionally conservative for circle/heart/etc.
     * It can include pixels outside the photo path, but can never exclude a
     * visible pixel, so wider panning does not introduce holes in exports.
     */
    PhotoWall.prototype._visibleCropBounds = function (item, width, height) {
        var md = this.maskData;
        if (!item || !item.isBoundary || !md || !md.mask || width <= 0 || height <= 0) return null;
        var rotation = Number(item.rotation) || 0;
        var cacheKey = [this._maskCacheKey, Number(item.x).toFixed(2), Number(item.y).toFixed(2),
            width.toFixed(2), height.toFixed(2), rotation.toFixed(2)].join('|');
        if (item._visibleCropCacheKey === cacheKey) return item._visibleCropBounds || null;

        var radians = rotation * Math.PI / 180;
        var cosine = Math.cos(radians), sine = Math.sin(radians);
        var halfWidth = width / 2, halfHeight = height / 2;
        var extentX = Math.abs(halfWidth * cosine) + Math.abs(halfHeight * sine);
        var extentY = Math.abs(halfWidth * sine) + Math.abs(halfHeight * cosine);
        var x1 = Math.max(0, Math.floor(item.x - extentX));
        var y1 = Math.max(0, Math.floor(item.y - extentY));
        var x2 = Math.min(md.width, Math.ceil(item.x + extentX));
        var y2 = Math.min(md.height, Math.ceil(item.y + extentY));
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        for (var py = y1; py < y2; py++) {
            for (var px = x1; px < x2; px++) {
                if (!md.mask[py * md.width + px]) continue;
                var dx = px + 0.5 - item.x;
                var dy = py + 0.5 - item.y;
                var localX = dx * cosine + dy * sine;
                var localY = -dx * sine + dy * cosine;
                if (Math.abs(localX) > halfWidth || Math.abs(localY) > halfHeight) continue;
                minX = Math.min(minX, localX);
                minY = Math.min(minY, localY);
                maxX = Math.max(maxX, localX);
                maxY = Math.max(maxY, localY);
            }
        }

        var bounds = null;
        if (Number.isFinite(minX)) {
            /* Include antialiased edge pixels and rounding differences between
               the editor canvas and high-resolution export canvases. */
            var padding = Math.max(1.5, Math.min(width, height) * 0.012);
            var left = Math.max(-halfWidth, minX - padding);
            var top = Math.max(-halfHeight, minY - padding);
            var right = Math.min(halfWidth, maxX + padding);
            var bottom = Math.min(halfHeight, maxY + padding);
            bounds = {
                x: Math.max(0, Math.min(1, (left + halfWidth) / width)),
                y: Math.max(0, Math.min(1, (top + halfHeight) / height)),
                width: Math.max(0.01, Math.min(1, (right - left) / width)),
                height: Math.max(0.01, Math.min(1, (bottom - top) / height))
            };
            if (bounds.width > 0.985 && bounds.height > 0.985) bounds = null;
        }
        item._visibleCropCacheKey = cacheKey;
        item._visibleCropBounds = bounds;
        return bounds;
    };

    PhotoWall.prototype._fitBoundaryCell = function (x, y, width, height, allowGrowth) {
        var cellArea = Math.max(1, width * height);
        var visible = this._rectMaskArea(x, y, width, height);
        var coverage = visible / cellArea;
        if (coverage >= 0.62 || allowGrowth === false) {
            var directCentroid = this._visibleMaskCentroid(x, y, width, height);
            return {
                x: x, y: y, width: width, height: height, coverage: coverage,
                isBoundary: coverage < 0.9, visibleFocusX: directCentroid.x, visibleFocusY: directCentroid.y
            };
        }

        // Keep the original edge cell covered, then grow it toward nearby
        // interior mask pixels. This turns tiny contour slivers into useful,
        // organically sized photo windows without punching holes in the mask.
        var grow = [0, 0.2, 0.35];
        var best = { x: x, y: y, width: width, height: height, coverage: coverage, visible: visible, score: coverage * 0.28 };
        for (var leftIndex = 0; leftIndex < grow.length; leftIndex++) {
            for (var rightIndex = 0; rightIndex < grow.length; rightIndex++) {
                var leftGrow = grow[leftIndex] * width;
                var rightGrow = grow[rightIndex] * width;
                for (var topIndex = 0; topIndex < grow.length; topIndex++) {
                    for (var bottomIndex = 0; bottomIndex < grow.length; bottomIndex++) {
                        var topGrow = grow[topIndex] * height;
                        var bottomGrow = grow[bottomIndex] * height;
                        var candidateX = x - leftGrow, candidateY = y - topGrow;
                        var candidateWidth = width + leftGrow + rightGrow;
                        var candidateHeight = height + topGrow + bottomGrow;
                        var candidateArea = candidateWidth * candidateHeight;
                        var candidateVisible = this._rectMaskArea(candidateX, candidateY, candidateWidth, candidateHeight);
                        var candidateCoverage = candidateVisible / Math.max(1, candidateArea);
                        var visibleGain = (candidateVisible - visible) / cellArea;
                        var expansion = candidateArea / cellArea - 1;
                        var score = visibleGain * 0.78 + candidateCoverage * 0.28 - expansion * 0.035;
                        if (score > best.score && candidateVisible > visible * 1.2) {
                            best = {
                                x: candidateX,
                                y: candidateY,
                                width: candidateWidth,
                                height: candidateHeight,
                                coverage: candidateCoverage,
                                visible: candidateVisible,
                                score: score
                            };
                        }
                    }
                }
            }
        }
        best.isBoundary = true;
        var centroid = this._visibleMaskCentroid(best.x, best.y, best.width, best.height);
        best.visibleFocusX = centroid.x;
        best.visibleFocusY = centroid.y;
        return best;
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
                // Exact grid/brick ownership stays fixed. Organic layouts may
                // grow a thin contour cell modestly toward visible interior
                // pixels; the 35% cap avoids the former neighbour-cover risk.
                var fitted = this._fitBoundaryCell(
                    x, y, cellW, cellH, this.placementMode === 'organic'
                );
                var jitterX = 0, jitterY = 0;
                if (this.placementMode === 'organic' && !fitted.isBoundary) {
                    var seed = mixSeed(this.layoutSeed,
                        ((row + 1) * 73856093 ^ (col + 1) * 19349663) >>> 0);
                    jitterX = ((seed % 101) / 100 - 0.5) * cellW * 0.22;
                    jitterY = (((seed >>> 8) % 101) / 100 - 0.5) * cellH * 0.22;
                }
                cells.push({
                    x: fitted.x + fitted.width / 2 + jitterX,
                    y: fitted.y + fitted.height / 2 + jitterY,
                    baseX: fitted.x,
                    baseY: fitted.y,
                    width: fitted.width,
                    height: fitted.height,
                    size: Math.max(fitted.width, fitted.height),
                    row: row,
                    col: col,
                    isLarge: false,
                    isBoundary: fitted.isBoundary === true,
                    maskCoverage: fitted.coverage,
                    visibleArea: fitted.coverage * fitted.width * fitted.height,
                    visibleFocusX: fitted.visibleFocusX,
                    visibleFocusY: fitted.visibleFocusY,
                    boundaryDistance: sampleDistance(this.maskData.distance, this.maskData.width, this.maskData.height,
                        fitted.x + fitted.width / 2, fitted.y + fitted.height / 2)
                });
            }
        }
        return cells;
    };

    PhotoWall.prototype._buildMatrixCells = function (size) {
        var b = this.maskData.bounds, cells = [];
        var columns = Math.max(1, Number(size) || 1);
        var rows = columns;
        var cellW = b.width / columns;
        var cellH = b.height / rows;
        for (var row = 0; row < rows; row++) {
            for (var col = 0; col < columns; col++) {
                var x = b.x + col * cellW;
                var y = b.y + row * cellH;
                if (this._rectMaskArea(x, y, cellW, cellH) === 0) continue;
                // Matrix cells must stay inside their exact row/column bounds.
                var fitted = this._fitBoundaryCell(x, y, cellW, cellH, false);
                cells.push({
                    x: fitted.x + fitted.width / 2,
                    y: fitted.y + fitted.height / 2,
                    baseX: fitted.x,
                    baseY: fitted.y,
                    width: fitted.width,
                    height: fitted.height,
                    size: Math.max(fitted.width, fitted.height),
                    row: row,
                    col: col,
                    isLarge: false,
                    isBoundary: fitted.isBoundary === true,
                    maskCoverage: fitted.coverage,
                    visibleArea: fitted.coverage * fitted.width * fitted.height,
                    visibleFocusX: fitted.visibleFocusX,
                    visibleFocusY: fitted.visibleFocusY,
                    boundaryDistance: sampleDistance(this.maskData.distance, this.maskData.width, this.maskData.height,
                        fitted.x + fitted.width / 2, fitted.y + fitted.height / 2)
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
            if (cell.isBoundary) return;
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
                coverage: coverage,
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
                maskCoverage: candidate.coverage,
                visibleArea: candidate.coverage * candidate.width * candidate.height,
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
        /* restoreState() swaps this.photos directly before regenerating, so
           the looping-video pool is diffed here as well as in setPhotos(). */
        if (this.videoPlayer) this.videoPlayer.sync(this.photos);
        this.generateMask();
        if (!this.photos.length || !this.maskData.insideCount) {
            this.layout = [];
            this._invalidateRenderCache();
            this._refreshOrderCache();
            this.render();
            if (this.onLayout) this.onLayout(0, 0);
            return;
        }
        var b = this.maskData.bounds;
        var target = Math.max(1, Math.round(this.photos.length * this.density));
        if (this.matrixColumns > 0) {
            var matrixCells = this._buildMatrixCells(this.matrixColumns);
            this.layout = this._assignPhotos(matrixCells, forceRandom);
            this._invalidateRenderCache();
            this._refreshOrderCache();
            this.hoveredIndex = -1; this.draggingIndex = -1; this.dragOverIndex = -1;
            if (this.onLayout) this.onLayout(this.layout.length, 0);
            if (skipAnimation) this.render(); else this._animate();
            return;
        }
        var desiredLarge = this.mixedSizes && target >= 8 ? Math.max(1, Math.min(80, Math.round(target * 0.1))) : 0;
        var reductionPerLarge = this.placementMode === 'brick' ? 1 : 3;
        var baseTarget = target + desiredLarge * reductionPerLarge;
        var fillRatio = this.maskData.insideCount / Math.max(1, b.width * b.height);
        var estimated = Math.sqrt((b.width * b.height * fillRatio) / baseTarget);
        var low = Math.max(8, estimated * 0.5);
        var high = Math.max(low + 1, estimated * 2);
        var bestSize = estimated, bestCount = this._countCells(estimated), bestDelta = Math.abs(bestCount - baseTarget);
        var coveringSize = bestCount >= baseTarget ? bestSize : null;
        var coveringCount = bestCount >= baseTarget ? bestCount : Infinity;
        function rememberCoveringCandidate(size, count) {
            if (count < baseTarget) return;
            if (coveringSize === null || count < coveringCount || (count === coveringCount && size > coveringSize)) {
                coveringSize = size;
                coveringCount = count;
            }
        }
        var lowCount = this._countCells(low);
        rememberCoveringCandidate(low, lowCount);
        rememberCoveringCandidate(high, this._countCells(high));
        for (var search = 0; search < 9; search++) {
            var candidateSize = (low + high) / 2;
            var candidateCount = this._countCells(candidateSize);
            rememberCoveringCandidate(candidateSize, candidateCount);
            var delta = Math.abs(candidateCount - baseTarget);
            if (delta < bestDelta || (delta === bestDelta && candidateCount >= baseTarget && bestCount < baseTarget)) {
                bestSize = candidateSize;
                bestCount = candidateCount;
                bestDelta = delta;
            }
            if (candidateCount > baseTarget) low = candidateSize;
            else high = candidateSize;
        }
        // Automatic layouts should never silently omit an imported asset.
        // When cell-count steps skip over the exact target, prefer the small
        // overshoot so every source receives at least one slot.
        if (bestCount < baseTarget && coveringSize !== null) bestSize = coveringSize;
        var best = this._buildCells(Math.max(8, bestSize));
        best = this._mergeLargeCells(best, desiredLarge);
        this.layout = this._assignPhotos(best, forceRandom);
        this._invalidateRenderCache();
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
                height: this.cssHeight,
                seed: this.layoutSeed
            });
        } else {
            var random = createSeededRandom(this.layoutSeed);
            for (var s = order.length - 1; s > 0; s--) {
                var r = Math.floor(random() * (s + 1));
                var tmp = order[s]; order[s] = order[r]; order[r] = tmp;
            }
        }
        return cells.map(function (cell, index) {
            var photoIndex = order[index % order.length];
            var seed = mixSeed(this.layoutSeed,
                (((cell.row + 1) * 2654435761) ^ ((cell.col + 1) * 1597334677) ^ (index * 3812015801)) >>> 0);
            var unitRotation = (seed % 2001) / 1000 - 1;
            cell.slotId = 'slot-' + (++this._slotSequence) + '-' + seed.toString(36);
            cell.photoIndex = photoIndex;
            cell.photo = this.photos[photoIndex];
            cell.photoId = cell.photo.id;
            cell.rotation = this.rotationRange ? unitRotation * this.rotationRange : 0;
            cell.zIndex = cell.isBoundary ? index - cells.length : index;
            return cell;
        }, this);
    };

    PhotoWall.prototype._animate = function () {
        if (this.assetManager) {
            this.render();
            return;
        }
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

    PhotoWall.prototype._cancelLayerTransition = function () {
        if (this._transitionRAF) cancelAnimationFrame(this._transitionRAF);
        this._transitionRAF = null;
        this._transitionPendingDuration = 0;
        this._transitionProgress = 1;
    };

    PhotoWall.prototype._capturePreviousLayer = function (duration) {
        this._cancelLayerTransition();
        if (!duration || !this._hasComposedLayer || !this._layerCanvas.width) return;
        var previous = this._previousLayerCanvas;
        if (previous.width !== this._layerCanvas.width || previous.height !== this._layerCanvas.height) {
            previous.width = this._layerCanvas.width;
            previous.height = this._layerCanvas.height;
        }
        this._previousLayerContext.setTransform(1, 0, 0, 1, 0, 0);
        this._previousLayerContext.clearRect(0, 0, previous.width, previous.height);
        this._previousLayerContext.drawImage(this._layerCanvas, 0, 0);
        this._transitionPendingDuration = duration;
        this._transitionProgress = 0;
    };

    PhotoWall.prototype._startLayerTransition = function () {
        var duration = this._transitionPendingDuration;
        if (!duration) return;
        this._transitionPendingDuration = 0;
        var self = this;
        var startedAt = performance.now();
        function frame(now) {
            var elapsed = Math.max(0, now - startedAt);
            self._transitionProgress = Math.min(1, elapsed / duration);
            self.render();
            if (self._transitionProgress < 1) self._transitionRAF = requestAnimationFrame(frame);
            else self._transitionRAF = null;
        }
        this._transitionRAF = requestAnimationFrame(frame);
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

        /* Timeline playback: bypass the normal static compose path. */
        if (this._playbackFrame) {
            this.renderPlaybackFrame(ctx, this._playbackFrame, {
                sourceFrame: { x: 0, y: 0, width: w, height: h }
            });
            this._ensureVideoLoop();
            return;
        }

        var layer = this._layerCanvas, lx = this._layerContext;
        var targetWidth = Math.round(w * this.dpr), targetHeight = Math.round(h * this.dpr);
        if (layer.width !== targetWidth || layer.height !== targetHeight) {
            layer.width = targetWidth; layer.height = targetHeight;
            this._cachedLayerRevision = -1;
        }
        var t = progress === undefined ? 1 : Math.max(0, Math.min(1, progress));
        var eased = 1 - Math.pow(1 - t, 3);
        var cacheable = !exportMode && t >= 1;
        if (this.assetManager && this._cachedLayerRevision !== this._renderRevision) {
            this._composeLayerAsync(this._renderRevision);
        } else if (!cacheable || this._cachedLayerRevision !== this._renderRevision) {
            lx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
            lx.clearRect(0, 0, w, h);
            lx.globalCompositeOperation = 'source-over';
            lx.globalAlpha = 1;
            if (this._renderOrder.length !== this.layout.length) this._refreshOrderCache();
            var renderOrder = this._renderOrder;
            for (var orderIndex = 0; orderIndex < renderOrder.length; orderIndex++) {
                var i = renderOrder[orderIndex];
                this._drawPhoto(lx, this.layout[i], false, eased, false);
            }
            lx.globalCompositeOperation = 'destination-in';
            lx.drawImage(this.maskData.maskCanvas, 0, 0, w, h);
            lx.globalCompositeOperation = 'source-over';
            if (cacheable) this._cachedLayerRevision = this._renderRevision;
        }
        if (!this.assetManager || this._hasComposedLayer) {
            if (this._transitionProgress < 1 && this._previousLayerCanvas.width) {
                ctx.drawImage(this._previousLayerCanvas, 0, 0, w, h);
                ctx.save();
                ctx.globalAlpha = 1 - Math.pow(1 - this._transitionProgress, 2);
                ctx.drawImage(layer, 0, 0, w, h);
                ctx.restore();
            } else {
                ctx.drawImage(layer, 0, 0, w, h);
            }
        }
        /* Looping video cells repaint every frame on top of the cached
           poster layer once the layer transition has settled. */
        if (this.assetManager && this.videoPlayer &&
            this._hasComposedLayer && this._transitionProgress >= 1) {
            this._drawLiveVideoCells(ctx, w, h);
            this._ensureVideoLoop();
        }
        var previewingLocalAdjust = this.localAdjustPreviewIndex >= 0 &&
            ((this._pointerDown && this._pointerDown.adjusted) ||
                this._cachedLayerRevision !== this._renderRevision);
        if (!exportMode && previewingLocalAdjust && this.layout[this.localAdjustPreviewIndex]) {
            this._drawPhoto(ctx, this.layout[this.localAdjustPreviewIndex], false, 1, false);
            ctx.save();
            ctx.globalCompositeOperation = 'destination-in';
            ctx.drawImage(this.maskData.maskCanvas, 0, 0, w, h);
            ctx.restore();
        }
        drawOverlays(ctx, this.overlays, w, h, { bounds: this.getExportBounds() });

        // Hovering and dragging used to redraw every photo on every pointer
        // event. The static composition now stays cached; only lightweight
        // outlines and the drag ghost are painted over it.
        if (!exportMode && this.hoveredIndex >= 0 && this.draggingIndex < 0) {
            this._drawPhotoHighlight(ctx, this.layout[this.hoveredIndex], false);
        }
        if (!exportMode && this.interactionMode === 'adjust' && this.localAdjustIndex >= 0 &&
            this.localAdjustIndex !== this.hoveredIndex) {
            this._drawPhotoHighlight(ctx, this.layout[this.localAdjustIndex], false);
        }
        if (!exportMode && this.dragOverIndex >= 0) {
            this._drawPhotoHighlight(ctx, this.layout[this.dragOverIndex], true);
        }
        if (!exportMode && this.draggingIndex >= 0 && this.pointer) {
            var dragged = this.layout[this.draggingIndex];
            var ghost = Object.assign({}, dragged, { x: this.pointer.x, y: this.pointer.y });
            ctx.save(); ctx.globalAlpha = 0.82;
            this._drawPhoto(ctx, ghost, true, 1, false);
            ctx.restore();
        }
        if (!exportMode) this._drawOutline(ctx);
        if (!exportMode && this.selectedOverlayId) {
            var selected = this.overlays.find(function (overlay) { return overlay.id === this.selectedOverlayId; }, this);
            if (selected && selected.type !== 'border' && selected.visible !== false) {
                var size = (Number(selected.fontSize) || 0.055) * Math.min(w, h);
                ctx.save();
                ctx.translate((Number(selected.x) || 0.5) * w, (Number(selected.y) || 0.5) * h);
                ctx.rotate((Number(selected.rotation) || 0) * Math.PI / 180);
                ctx.setLineDash([4, 3]);
                ctx.strokeStyle = '#60e1be';
                ctx.lineWidth = 1.5;
                ctx.strokeRect(-size * Math.max(1, String(selected.content || '').length * .34), -size * .72,
                    size * Math.max(2, String(selected.content || '').length * .68), size * 1.44);
                ctx.restore();
            }
        }
    };

    PhotoWall.prototype._drawPhotoHighlight = function (ctx, item, dropTarget) {
        if (!item) return;
        var gapScale = Math.max(0.4, 1 - this.gap);
        var width = item.width * gapScale, height = item.height * gapScale;
        if (this.photoShape !== 'square') { width *= 1.16; height *= 1.16; }
        ctx.save();
        ctx.translate(item.x, item.y);
        ctx.rotate((Number(item.rotation) || 0) * Math.PI / 180);
        ctx.shadowColor = dropTarget ? 'rgba(96,225,190,.9)' : 'rgba(124,108,240,.75)';
        ctx.shadowBlur = 12;
        ctx.lineWidth = dropTarget ? 3 : 2;
        ctx.strokeStyle = dropTarget ? '#60e1be' : '#a99cff';
        this._photoPath(ctx, 0, 0, width, height);
        ctx.stroke();
        ctx.restore();
    };

    /* ================================================================ */
    /* Looping video cells                                               */
    /* ================================================================ */

    /**
     * Repaint every cell whose photo is a looping video with its current
     * frame. Called once per animation frame while videos are active; the
     * cached layer below still holds the poster as a loading placeholder.
     */
    PhotoWall.prototype._drawLiveVideoCells = function (ctx, w, h) {
        if (!this.maskData || !this.layout.length || !this.videoPlayer) return;
        var drew = false;
        for (var i = 0; i < this.layout.length; i++) {
            var item = this.layout[i];
            var video = item && item.photo && this.videoPlayer.get(item.photo);
            if (!video) continue;
            this._drawPhoto(ctx, item, false, 1, false, video);
            drew = true;
        }
        if (drew) {
            /* Boundary cells can extend past the silhouette; clip the fresh
               frames exactly like the cached layer underneath them. */
            ctx.save();
            ctx.globalCompositeOperation = 'destination-in';
            ctx.drawImage(this.maskData.maskCanvas, 0, 0, w, h);
            ctx.restore();
        }
    };

    /** Keep repainting the wall while any looping video has frames to show. */
    PhotoWall.prototype._ensureVideoLoop = function () {
        if (this._videoLoopToken || !this.videoPlayer || !this.cssWidth) return;
        if (!this.layout.length || !this.videoPlayer.hasReady()) return;
        if (typeof document !== 'undefined' && document.hidden) return;
        var self = this;
        /* A token (not the rAF handle) guards the chain: render() re-enters
           this method mid-tick, and an rAF handle cannot cancel callbacks
           that are already queued, which multiplied parallel chains. */
        var token = {};
        this._videoLoopToken = token;
        function tick() {
            if (self._videoLoopToken !== token) return;
            if (!self.videoPlayer || !self.videoPlayer.hasReady() ||
                (typeof document !== 'undefined' && document.hidden)) {
                self._videoLoopToken = null;
                return;
            }
            self.render();
            if (self._videoLoopToken !== token) return;
            if (!self.videoPlayer.hasReady()) {
                self._videoLoopToken = null;
                return;
            }
            requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
    };

    PhotoWall.prototype._stopVideoLoop = function () {
        this._videoLoopToken = null;
    };

    /* ================================================================ */
    /* Reveal-mode playback rendering                                    */
    /* ================================================================ */

    /**
     * Set per-cell reveal opacities and re-render the editor canvas.
     * Each value in the Float32Array maps to layout[i] (0 = hidden, 1 = shown).
     */
    PhotoWall.prototype.setPlaybackFrame = function (frame) {
        this._playbackFrame = frame || null;
        /* Bypass the layer cache during reveal animation. */
        this._cachedLayerRevision = -1;
        this.render();
    };

    PhotoWall.prototype.clearPlayback = function () {
        this._playbackFrame = null;
        this._cachedLayerRevision = -1;
        this.render();
    };

    PhotoWall.prototype.clearReveal = function () {
        this.clearPlayback();
    };

    /** Render a reveal or shuffle Timeline frame to the editor or exporter. */
    PhotoWall.prototype.renderPlaybackFrame = function (ctx, frame, options) {
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
        var scratch = this._scratchItem || (this._scratchItem = {});
        var scratch2 = this._scratchItem2 || (this._scratchItem2 = {});
        for (var oi = 0; oi < renderOrder.length; oi++) {
            var ci = renderOrder[oi];
            var alpha = frame.opacities ? Math.max(0, Math.min(1, frame.opacities[ci] || 0)) : 1;
            if (alpha <= 0) continue;
            var cellScale = frame.scales ? Math.max(0.5, Math.min(1, frame.scales[ci] || 1)) : 1;
            var item = this.layout[ci];
            var playbackX = frame.offsetsX ? Number(frame.offsetsX[ci]) || 0 : 0;
            var playbackY = frame.offsetsY ? Number(frame.offsetsY[ci]) || 0 : 0;
            var playbackZoom = frame.photoZooms ? Number(frame.photoZooms[ci]) || 1 : 1;
            /* Build the effective item in a reusable scratch object to avoid per-frame GC. */
            Object.assign(scratch, item);
            /* Always overwrite transient fields. Object.assign() does not
               remove playbackZoom left by the previous scratch item. */
            scratch.x = item.x + playbackX;
            scratch.y = item.y + playbackY;
            scratch.playbackZoom = playbackZoom;
            var previousIndex = frame.previousIndices && Number(frame.previousIndices[ci]);
            var nextIndex = frame.photoIndices && Number(frame.photoIndices[ci]);
            var progressValue = frame.transitionProgresses ? frame.transitionProgresses[ci] : frame.transitionProgress;
            var progress = Math.max(0, Math.min(1, Number(progressValue) || 0));
            if (frame.mode === 'shuffle' && Number.isInteger(previousIndex) && Number.isInteger(nextIndex) && previousIndex !== nextIndex) {
                var previousPhoto = this.photos[previousIndex];
                var nextPhoto = this.photos[nextIndex];
                if (previousPhoto && progress < 1) {
                    ctx.save();
                    ctx.globalAlpha = alpha * (1 - progress);
                    Object.assign(scratch2, scratch, {
                        photo: previousPhoto, photoIndex: previousIndex, photoId: previousPhoto.id
                    });
                    this._drawPhoto(ctx, scratch2, false, cellScale, false);
                    ctx.restore();
                }
                if (nextPhoto && progress > 0) {
                    ctx.save();
                    ctx.globalAlpha = alpha * progress;
                    Object.assign(scratch2, scratch, {
                        photo: nextPhoto, photoIndex: nextIndex, photoId: nextPhoto.id
                    });
                    this._drawPhoto(ctx, scratch2, false, cellScale, false);
                    ctx.restore();
                }
            } else {
                var assignedPhoto = Number.isInteger(nextIndex) ? this.photos[nextIndex] : null;
                if (assignedPhoto) {
                    Object.assign(scratch2, scratch, {
                        photo: assignedPhoto, photoIndex: nextIndex, photoId: assignedPhoto.id
                    });
                    ctx.save();
                    ctx.globalAlpha = alpha;
                    this._drawPhoto(ctx, scratch2, false, cellScale, false);
                    ctx.restore();
                } else {
                    ctx.save();
                    ctx.globalAlpha = alpha;
                    this._drawPhoto(ctx, scratch, false, cellScale, false);
                    ctx.restore();
                }
            }
        }
        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(this.maskData.maskCanvas, 0, 0, this.cssWidth, this.cssHeight);
        ctx.globalCompositeOperation = 'source-over';
        drawOverlays(ctx, this.overlays, this.cssWidth, this.cssHeight, { bounds: this.getExportBounds() });
        ctx.restore();

        if (options.background && options.background !== 'transparent') {
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalCompositeOperation = 'destination-over';
            ctx.fillStyle = options.background;
            ctx.fillRect(0, 0, outputWidth, outputHeight);
            ctx.restore();
        }
    };

    /**
     * Async export renderer. The live renderer intentionally stays synchronous,
     * but export must not assume every photo remains resident in the bounded
     * bitmap LRU. Resolve each source immediately before drawing it so a large
     * wall cannot export blank cells merely because an older bitmap was evicted.
     */
    PhotoWall.prototype.renderPlaybackFrameAsync = async function (ctx, frame, options) {
        if (!this.assetManager) {
            this.renderPlaybackFrame(ctx, frame, options);
            return;
        }
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
        var self = this;
        var scratch = this._scratchAsyncItem || (this._scratchAsyncItem = {});
        var preferThumbnail = this.photos.length > 64;
        var sourcePromises = new Map();

        function sourceFor(photo) {
            if (!photo) return Promise.resolve(null);
            if (photo.mediaType === 'video' && self.videoPlayer) {
                return Promise.resolve().then(async function () {
                    if (Number.isFinite(Number(options.videoTime)) &&
                        typeof self.videoPlayer.preparePhotoFrame === 'function') {
                        var prepared = await self.videoPlayer.preparePhotoFrame(photo, Number(options.videoTime));
                        if (prepared) return prepared;
                    }
                    return self.videoPlayer.get(photo);
                }).then(function (live) {
                    if (live) return live;
                    var firstVideoFallback = preferThumbnail ? 'thumbnail' : 'working';
                    var secondVideoFallback = preferThumbnail ? 'working' : 'thumbnail';
                    return self.assetManager.getBitmap(photo, firstVideoFallback)
                        .catch(function () { return self.assetManager.getBitmap(photo, secondVideoFallback); })
                        .catch(function () { return photo.img || null; });
                });
            }
            var key = photo.id || photo;
            if (sourcePromises.has(key)) return sourcePromises.get(key);
            var promise = Promise.resolve().then(async function () {
                var first = preferThumbnail ? 'thumbnail' : 'working';
                var second = preferThumbnail ? 'working' : 'thumbnail';
                try {
                    return await self.assetManager.getBitmap(photo, first);
                } catch (workingError) {
                    try {
                        return await self.assetManager.getBitmap(photo, second);
                    } catch (_) {
                        return photo.img || null;
                    }
                }
            });
            sourcePromises.set(key, promise);
            return promise;
        }

        async function drawResolved(photo, item, photoIndex, alpha, cellScale) {
            if (!photo || alpha <= 0) return;
            var source = await sourceFor(photo);
            if (!source) return;
            Object.assign(scratch, item, {
                photo: photo,
                photoIndex: photoIndex,
                photoId: photo.id
            });
            ctx.save();
            ctx.globalAlpha = alpha;
            self._drawPhoto(ctx, scratch, false, cellScale, false, source);
            ctx.restore();
        }

        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, outputWidth, outputHeight);
        ctx.setTransform(scaleX, 0, 0, scaleY, -sourceFrame.x * scaleX, -sourceFrame.y * scaleY);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        if (this._renderOrder.length !== this.layout.length) this._refreshOrderCache();

        for (var oi = 0; oi < this._renderOrder.length; oi++) {
            var ci = this._renderOrder[oi];
            var alpha = frame.opacities ? Math.max(0, Math.min(1, frame.opacities[ci] || 0)) : 1;
            if (alpha <= 0) continue;
            var cellScale = frame.scales ? Math.max(0.5, Math.min(1, frame.scales[ci] || 1)) : 1;
            var item = this.layout[ci];
            var playbackX = frame.offsetsX ? Number(frame.offsetsX[ci]) || 0 : 0;
            var playbackY = frame.offsetsY ? Number(frame.offsetsY[ci]) || 0 : 0;
            var playbackZoom = frame.photoZooms ? Number(frame.photoZooms[ci]) || 1 : 1;
            var effectiveItem = Object.assign({}, item, {
                x: item.x + playbackX,
                y: item.y + playbackY,
                playbackZoom: playbackZoom
            });
            var previousIndex = frame.previousIndices && Number(frame.previousIndices[ci]);
            var nextIndex = frame.photoIndices && Number(frame.photoIndices[ci]);
            var progressValue = frame.transitionProgresses ? frame.transitionProgresses[ci] : frame.transitionProgress;
            var progress = Math.max(0, Math.min(1, Number(progressValue) || 0));

            if (frame.mode === 'shuffle' && Number.isInteger(previousIndex) &&
                Number.isInteger(nextIndex) && previousIndex !== nextIndex) {
                if (progress < 1) {
                    await drawResolved(this.photos[previousIndex], effectiveItem, previousIndex,
                        alpha * (1 - progress), cellScale);
                }
                if (progress > 0) {
                    await drawResolved(this.photos[nextIndex], effectiveItem, nextIndex,
                        alpha * progress, cellScale);
                }
            } else {
                var assignedIndex = Number.isInteger(nextIndex) ? nextIndex : item.photoIndex;
                var assignedPhoto = Number.isInteger(assignedIndex) ? this.photos[assignedIndex] : item.photo;
                await drawResolved(assignedPhoto, effectiveItem, assignedIndex, alpha, cellScale);
            }
        }

        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(this.maskData.maskCanvas, 0, 0, this.cssWidth, this.cssHeight);
        ctx.globalCompositeOperation = 'source-over';
        drawOverlays(ctx, this.overlays, this.cssWidth, this.cssHeight, { bounds: this.getExportBounds() });
        ctx.restore();

        if (options.background && options.background !== 'transparent') {
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalCompositeOperation = 'destination-over';
            ctx.fillStyle = options.background;
            ctx.fillRect(0, 0, outputWidth, outputHeight);
            ctx.restore();
        }
    };

    PhotoWall.prototype._composeLayerAsync = function (revision) {
        if (!this.assetManager || this._composeRevision === revision) return this._composePromise;
        this._composeRevision = revision;
        var self = this;
        this._composePromise = Promise.resolve().then(async function () {
            var w = Math.round(self.cssWidth), h = Math.round(self.cssHeight);
            var stage = self._stagingCanvas, context = self._stagingContext;
            var targetWidth = Math.round(w * self.dpr), targetHeight = Math.round(h * self.dpr);
            if (stage.width !== targetWidth || stage.height !== targetHeight) {
                stage.width = targetWidth;
                stage.height = targetHeight;
            }
            context.setTransform(self.dpr, 0, 0, self.dpr, 0, 0);
            context.clearRect(0, 0, w, h);
            context.globalCompositeOperation = 'source-over';
            if (self._renderOrder.length !== self.layout.length) self._refreshOrderCache();
            var missingSources = 0;
            for (var orderIndex = 0; orderIndex < self._renderOrder.length; orderIndex++) {
                if (revision !== self._renderRevision) return false;
                var item = self.layout[self._renderOrder[orderIndex]];
                var source = null;
                try {
                    source = await self.assetManager.getBitmap(item.photo, 'working');
                } catch (decodeError) {
                    console.warn('照片工作图解码失败:', decodeError);
                    try {
                        source = await self.assetManager.getBitmap(item.photo, 'thumbnail');
                    } catch (_) {
                        source = item.photo && item.photo.img;
                    }
                }
                if (revision !== self._renderRevision) return false;
                if (!source) missingSources++;
                if (source) {
                    try {
                        self._drawPhoto(context, item, false, 1, false, source);
                    } catch (drawError) {
                        console.warn('照片绘制失败:', drawError);
                    }
                }
            }
            context.globalCompositeOperation = 'destination-in';
            context.drawImage(self.maskData.maskCanvas, 0, 0, w, h);
            context.globalCompositeOperation = 'source-over';
            if (revision !== self._renderRevision) return false;

            var layer = self._layerCanvas, layerContext = self._layerContext;
            if (layer.width !== targetWidth || layer.height !== targetHeight) {
                layer.width = targetWidth;
                layer.height = targetHeight;
            }
            layerContext.setTransform(1, 0, 0, 1, 0, 0);
            layerContext.clearRect(0, 0, layer.width, layer.height);
            layerContext.drawImage(stage, 0, 0);
            self._cachedLayerRevision = revision;
            self.localAdjustPreviewIndex = -1;
            self._hasComposedLayer = true;
            self.photos.forEach(function (photo) { self.assetManager.releaseElement(photo); });
            self._startLayerTransition();
            self.render();
            if (missingSources && self._composeRetryCount < self._maxComposeRetries) {
                self._composeRetryCount++;
                var retryDelay = 180 * self._composeRetryCount;
                self._composeRetryTimer = setTimeout(function () {
                    self._composeRetryTimer = null;
                    if (revision !== self._renderRevision) return;
                    self._composeRevision = -1;
                    self._cachedLayerRevision = -1;
                    self.render();
                }, retryDelay);
            } else if (!missingSources) {
                self._composeRetryCount = 0;
            }
            return true;
        }).finally(function () {
            if (self._composeRevision === revision) self._composePromise = null;
        });
        return this._composePromise;
    };

    PhotoWall.prototype._drawPhoto = function (ctx, item, hovered, scale, dropTarget, imageOverride) {
        var gapScale = Math.max(0.4, 1 - this.gap);
        var width = item.width * gapScale, height = item.height * gapScale;
        if (this.photoShape !== 'square') { width *= 1.16; height *= 1.16; }
        var cropWidth = width, cropHeight = height;
        width *= scale;
        height *= scale;
        var img = imageOverride ||
            (this.videoPlayer && this.videoPlayer.get(item.photo)) ||
            (this.assetManager && this.assetManager.peekBitmap(item.photo, 'working')) ||
            (this.assetManager && this.assetManager.peekBitmap(item.photo, 'thumbnail')) ||
            item.photo.img;
        if (!img) return;
        var x = item.x, y = item.y;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate((Number(item.rotation) || 0) * Math.PI / 180);
        if (hovered || dropTarget) {
            ctx.shadowColor = dropTarget ? 'rgba(96,225,190,.9)' : 'rgba(124,108,240,.75)';
            ctx.shadowBlur = 16;
        }
        this._photoPath(ctx, 0, 0, width, height);
        ctx.clip();
        var localOffsetX = Math.max(-SLOT_LOCAL_OFFSET_LIMIT,
            Math.min(SLOT_LOCAL_OFFSET_LIMIT, Number(item.localOffsetX) || 0));
        var localOffsetY = Math.max(-SLOT_LOCAL_OFFSET_LIMIT,
            Math.min(SLOT_LOCAL_OFFSET_LIMIT, Number(item.localOffsetY) || 0));
        var localZoom = Math.max(SLOT_LOCAL_ZOOM_MIN,
            Math.min(SLOT_LOCAL_ZOOM_MAX, Number(item.localZoom) || SLOT_LOCAL_ZOOM_MIN));
        var visibleFocusX = Number(item.visibleFocusX);
        var visibleFocusY = Number(item.visibleFocusY);
        var maskCoverage = Number(item.maskCoverage);
        var photo = item.photo || {};
        var placement;
        var hasManualSlotOffset = Math.abs(localOffsetX) + Math.abs(localOffsetY) > 0.01;
        if (item.isBoundary && (photo.faceBox || photo.personBox) && this.maskData &&
            !photo._autoCropDisabled && !hasManualSlotOffset) {
            /* Subject-aware boundary placement: maximise visible face/person area. */
            var imageDims = photoImageDimensions(img);
            var cropCell = Object.assign({}, item, {
                width: cropWidth,
                height: cropHeight,
                localOffsetX: localOffsetX,
                localOffsetY: localOffsetY,
                photoShape: this.photoShape
            });
            var cropCacheKey = [
                this._maskCacheKey, item.slotId || (item.x + ':' + item.y), photo.id || item.photoIndex,
                cropWidth.toFixed(2), cropHeight.toFixed(2), Number(item.rotation) || 0,
                Number(photo.focusX) || 0.5, Number(photo.focusY) || 0.5,
                Number(photo.editZoom) || 1, Number(photo.editRotation) || 0,
                photo.flipX === true ? 1 : 0, photo.flipY === true ? 1 : 0
            ].join('|');
            placement = this._autoCropCache.get(cropCacheKey);
            if (!placement) {
                placement = computeOptimalPlacement(photo, cropCell, this.maskData, imageDims);
                if (this._autoCropCache.size >= 4096) {
                    this._autoCropCache.delete(this._autoCropCache.keys().next().value);
                }
                this._autoCropCache.set(cropCacheKey, placement);
            }
        } else {
            var boundaryZoom = item.isBoundary ?
                1.12 + Math.max(0, 0.75 - (Number.isFinite(maskCoverage) ? maskCoverage : 0.75)) * 0.4 : 1;
            placement = {
                targetX: item.isBoundary && Number.isFinite(visibleFocusX) ? visibleFocusX : 0.5,
                targetY: item.isBoundary && Number.isFinite(visibleFocusY) ? visibleFocusY : 0.5,
                offsetX: localOffsetX,
                offsetY: localOffsetY,
                /* photoCoverLayout clamps panning to the available source
                   overflow, so moving a photo must not silently force an
                   extra zoom that the zoom-out control cannot undo. */
                zoom: boundaryZoom
            };
        }
        if (localZoom !== SLOT_LOCAL_ZOOM_MIN) {
            placement = Object.assign({}, placement, { zoom: placement.zoom * localZoom });
        }
        if (scale >= 0.999 && item.isBoundary) {
            var safeBounds = this._visibleCropBounds(item, cropWidth, cropHeight);
            if (safeBounds) placement = Object.assign({}, placement, { safeBounds: safeBounds });
        }
        if (Number(item.playbackZoom) > 0 && Number(item.playbackZoom) !== 1) {
            placement = Object.assign({}, placement, { zoom: placement.zoom * Number(item.playbackZoom) });
        }
        drawPhotoCover(ctx, img, width, height, item.photo, placement);
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
            addRoundedRectPath(ctx, x - rx, y - ry, width, height, radius);
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
        var ratios = { '1:1': 1, '3:4': 3 / 4, '4:3': 4 / 3, '9:16': 9 / 16, '16:9': 16 / 9 };
        var targetRatio = ratios[aspectRatio];
        if (!targetRatio) return bounds;

        return this._expandBoundsToRatio(bounds, targetRatio);
    };

    PhotoWall.prototype._expandBoundsToRatio = function (bounds, targetRatio) {
        bounds = Object.assign({}, bounds);

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
        var ratioUnits = { '1:1': [1, 1], '3:4': [3, 4], '4:3': [4, 3], '9:16': [9, 16], '16:9': [16, 9] }[aspectRatio];
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
        var bounds = options.targetAspect ?
            this._expandBoundsToRatio(this.getExportBounds(), Number(options.targetAspect)) :
            this.getExportFrame(options.aspectRatio);
        var dimensions = options.targetAspect ? {
            width: Math.max(1, Math.round(bounds.width * scale)),
            height: Math.max(1, Math.round(bounds.height * scale))
        } : this.getExportDimensions(scale, options.aspectRatio);
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

        if (this.assetManager) {
            // Lightweight previews reuse the already composed editor layer.
            ox.setTransform(scale / this.dpr, 0, 0, scale / this.dpr,
                -bounds.x * scale, -bounds.y * scale);
            ox.drawImage(this._layerCanvas, 0, 0);
            ox.setTransform(1, 0, 0, 1, 0, 0);
        } else {
            // Legacy synchronous path for environments without an asset manager.
            ox.setTransform(scale, 0, 0, scale, -bounds.x * scale, -bounds.y * scale);
            if (this._renderOrder.length !== this.layout.length) this._refreshOrderCache();
            for (var i = 0; i < this._renderOrder.length; i++) {
                this._drawPhoto(ox, this.layout[this._renderOrder[i]], false, 1, false);
            }
            ox.globalCompositeOperation = 'destination-in';
            ox.drawImage(this.maskData.maskCanvas, 0, 0, this.cssWidth, this.cssHeight);
            ox.setTransform(1, 0, 0, 1, 0, 0);
        }

        ox.setTransform(scale, 0, 0, scale, -bounds.x * scale, -bounds.y * scale);
        drawOverlays(ox, this.overlays, this.cssWidth, this.cssHeight, { bounds: this.getExportBounds() });
        ox.setTransform(1, 0, 0, 1, 0, 0);

        if (background && background !== 'transparent') {
            ox.globalCompositeOperation = 'destination-over';
            ox.fillStyle = background;
            ox.fillRect(0, 0, out.width, out.height);
        }
        ox.globalCompositeOperation = 'source-over';
        return out;
    };

    PhotoWall.prototype.createExportCanvasAsync = async function (options) {
        options = options || {};
        if (!this.assetManager) return this.createExportCanvas(options);
        var background = options.background === undefined ? '#ffffff' : options.background;
        var dimensions;
        var bounds;
        if (options.targetWidth && options.targetHeight) {
            dimensions = {
                width: Math.max(1, Math.round(options.targetWidth)),
                height: Math.max(1, Math.round(options.targetHeight))
            };
            bounds = this._expandBoundsToRatio(this.getExportBounds(), dimensions.width / dimensions.height);
        } else {
            var scale = Math.max(0.1, Math.min(3, Number(options.scale) || 2));
            bounds = this.getExportFrame(options.aspectRatio);
            dimensions = this.getExportDimensions(scale, options.aspectRatio);
        }
        var output = document.createElement('canvas');
        output.width = dimensions.width;
        output.height = dimensions.height;
        var context = output.getContext('2d');
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        var renderScale = Math.min(dimensions.width / bounds.width, dimensions.height / bounds.height);
        var offsetX = (dimensions.width - bounds.width * renderScale) / 2 - bounds.x * renderScale;
        var offsetY = (dimensions.height - bounds.height * renderScale) / 2 - bounds.y * renderScale;
        context.setTransform(renderScale, 0, 0, renderScale, offsetX, offsetY);
        if (this._renderOrder.length !== this.layout.length) this._refreshOrderCache();
        for (var i = 0; i < this._renderOrder.length; i++) {
            var item = this.layout[this._renderOrder[i]];
            var bitmap = await this.assetManager.getBitmap(item.photo, options.useOriginal === false ? 'working' : 'original');
            this._drawPhoto(context, item, false, 1, false, bitmap);
        }
        context.globalCompositeOperation = 'destination-in';
        context.drawImage(this.maskData.maskCanvas, 0, 0, this.cssWidth, this.cssHeight);
        context.globalCompositeOperation = 'source-over';
        drawOverlays(context, this.overlays, this.cssWidth, this.cssHeight, { bounds: this.getExportBounds() });
        context.setTransform(1, 0, 0, 1, 0, 0);
        if (background && background !== 'transparent') {
            context.globalCompositeOperation = 'destination-over';
            context.fillStyle = background;
            context.fillRect(0, 0, output.width, output.height);
        }
        context.globalCompositeOperation = 'source-over';
        return output;
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
        this._invalidateRenderCache();
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
                    isBoundary: item.isBoundary === true,
                    maskCoverage: item.maskCoverage,
                    visibleFocusX: item.visibleFocusX,
                    visibleFocusY: item.visibleFocusY,
                    localOffsetX: Number(item.localOffsetX) || 0,
                    localOffsetY: Number(item.localOffsetY) || 0,
                    localZoom: Math.max(SLOT_LOCAL_ZOOM_MIN,
                        Math.min(SLOT_LOCAL_ZOOM_MAX, Number(item.localZoom) || SLOT_LOCAL_ZOOM_MIN)),
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
                isBoundary: saved.isBoundary === true,
                maskCoverage: Math.max(0, Math.min(1, Number(saved.maskCoverage) || 0)),
                visibleFocusX: Number.isFinite(Number(saved.visibleFocusX)) ?
                    Math.max(0, Math.min(1, Number(saved.visibleFocusX))) : 0.5,
                visibleFocusY: Number.isFinite(Number(saved.visibleFocusY)) ?
                    Math.max(0, Math.min(1, Number(saved.visibleFocusY))) : 0.5,
                localOffsetX: Math.max(-SLOT_LOCAL_OFFSET_LIMIT,
                    Math.min(SLOT_LOCAL_OFFSET_LIMIT, Number(saved.localOffsetX) || 0)),
                localOffsetY: Math.max(-SLOT_LOCAL_OFFSET_LIMIT,
                    Math.min(SLOT_LOCAL_OFFSET_LIMIT, Number(saved.localOffsetY) || 0)),
                localZoom: Math.max(SLOT_LOCAL_ZOOM_MIN,
                    Math.min(SLOT_LOCAL_ZOOM_MAX, Number(saved.localZoom) || SLOT_LOCAL_ZOOM_MIN)),
                spanRows: Number(saved.spanRows) || 1,
                spanCols: Number(saved.spanCols) || 1,
                boundaryDistance: Math.max(0, Number(saved.boundaryDistance) || 0)
            };
            var itemLeft = item.x - item.width / 2;
            var itemTop = item.y - item.height / 2;
            if (!Number.isFinite(Number(saved.maskCoverage))) {
                item.maskCoverage = this._rectMaskArea(itemLeft, itemTop, item.width, item.height) /
                    Math.max(1, item.width * item.height);
            }
            item.isBoundary = saved.isBoundary === true || item.maskCoverage < 0.9;
            if (item.isBoundary && (!Number.isFinite(Number(saved.visibleFocusX)) || !Number.isFinite(Number(saved.visibleFocusY)))) {
                var visibleCentroid = this._visibleMaskCentroid(itemLeft, itemTop, item.width, item.height);
                item.visibleFocusX = visibleCentroid.x;
                item.visibleFocusY = visibleCentroid.y;
            }
            item.size = Math.max(item.width, item.height);
            restored.push(item);
        }, this);
        if (!restored.length) return false;
        this.layout = restored;
        this._invalidateRenderCache();
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
        this._invalidateRenderCache();
    };

    PhotoWall.prototype._bindEvents = function () {
        var self = this;
        this.canvas.addEventListener('pointerdown', function (e) {
            var p = self._eventPoint(e);
            var overlayId = getOverlayAt(self.ctx, self.overlays, p.x, p.y,
                self.cssWidth, self.cssHeight, self.getExportBounds());
            if (overlayId) {
                self.selectedOverlayId = overlayId;
                self._overlayPointerDown = { id: overlayId, x: p.x, y: p.y, recorded: false };
                if (self.onOverlaySelect) self.onOverlaySelect(overlayId);
                self.canvas.setPointerCapture(e.pointerId);
                self.render();
                return;
            }
            var idx = self.getPhotoAt(p.x, p.y);
            if (idx < 0) {
                if (self.interactionMode === 'adjust') self.selectLocalAdjust(-1);
                return;
            }
            if (self.interactionMode === 'adjust') self.selectLocalAdjust(idx);
            var selected = self.layout[idx];
            self._pointerDown = {
                x: p.x, y: p.y, index: idx, time: Date.now(), adjusted: false,
                localOffsetX: Number(selected.localOffsetX) || 0,
                localOffsetY: Number(selected.localOffsetY) || 0
            };
            self.canvas.setPointerCapture(e.pointerId);
        });
        this.canvas.addEventListener('pointermove', function (e) {
            var p = self._eventPoint(e);
            if (self._overlayPointerDown) {
                var overlay = self.overlays.find(function (item) { return item.id === self._overlayPointerDown.id; });
                if (!overlay) return;
                if (!self._overlayPointerDown.recorded && Math.hypot(p.x - self._overlayPointerDown.x, p.y - self._overlayPointerDown.y) > 3) {
                    self._overlayPointerDown.recorded = true;
                    if (self.onBeforeOverlayMove) self.onBeforeOverlayMove(overlay.id);
                }
                if (self._overlayPointerDown.recorded) {
                    overlay.x = Math.max(0, Math.min(1, p.x / Math.max(1, self.cssWidth)));
                    overlay.y = Math.max(0, Math.min(1, p.y / Math.max(1, self.cssHeight)));
                    self.canvas.style.cursor = 'grabbing';
                    self.render();
                }
                return;
            }
            if (self._pointerDown) {
                var moved = Math.hypot(p.x - self._pointerDown.x, p.y - self._pointerDown.y);
                if (self.interactionMode === 'adjust') {
                    var adjustedItem = self.layout[self._pointerDown.index];
                    if (moved > 3 && !self._pointerDown.adjusted) {
                        self._pointerDown.adjusted = true;
                        if (self.onBeforeLocalAdjust) self.onBeforeLocalAdjust(self._pointerDown.index);
                    }
                    if (self._pointerDown.adjusted && adjustedItem) {
                        self.localAdjustPreviewIndex = self._pointerDown.index;
                        adjustedItem.localOffsetX = Math.max(-SLOT_LOCAL_OFFSET_LIMIT, Math.min(SLOT_LOCAL_OFFSET_LIMIT,
                            self._pointerDown.localOffsetX + (p.x - self._pointerDown.x) / Math.max(20, adjustedItem.width * 0.5)));
                        adjustedItem.localOffsetY = Math.max(-SLOT_LOCAL_OFFSET_LIMIT, Math.min(SLOT_LOCAL_OFFSET_LIMIT,
                            self._pointerDown.localOffsetY + (p.y - self._pointerDown.y) / Math.max(20, adjustedItem.height * 0.5)));
                        self.canvas.style.cursor = 'grabbing';
                        self.render();
                    }
                    return;
                }
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
                self.hoveredIndex = hover;
                self.canvas.style.cursor = hover >= 0 ? (self.interactionMode === 'adjust' ? 'move' : 'grab') : 'default';
                if (!self._animRAF) self.render();
            }
        });
        function finish(e) {
            if (self._overlayPointerDown) {
                var moved = self._overlayPointerDown.recorded;
                self._overlayPointerDown = null;
                self.canvas.style.cursor = 'default';
                if (moved && self.onOverlayMove) self.onOverlayMove();
                self.render();
                try { self.canvas.releasePointerCapture(e.pointerId); } catch (ignore) {}
                return;
            }
            if (!self._pointerDown) return;
            var source = self._pointerDown.index, target = self.dragOverIndex;
            if (self.interactionMode === 'adjust') {
                var wasAdjusted = self._pointerDown.adjusted;
                self._pointerDown = null;
                self.canvas.style.cursor = 'move';
                if (wasAdjusted) {
                    self._invalidateRenderCache();
                    self.localAdjustPreviewIndex = source;
                    if (self.onLocalAdjust) self.onLocalAdjust(source);
                }
                self.render();
                try { self.canvas.releasePointerCapture(e.pointerId); } catch (ignore) {}
                return;
            }
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
