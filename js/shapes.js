/**
 * Shape definitions for Photo Wall
 *
 * Built-in shapes (china map, heart, portrait) use SVG path data.
 * Dynamic shapes (text/word/number, custom image) store a maskCanvas
 * directly — generateMask() draws it without expensive SVG path tracing.
 * A low-res thumbnail path is generated for the sidebar preview icon.
 */
(function (global) {
    'use strict';

    /* ------------------------------------------------------------------ *
     *  Heart path — classic parametric heart equation
     * ------------------------------------------------------------------ */
    function generateHeartPath() {
        var steps = 300;
        var raw = [];
        var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

        for (var i = 0; i <= steps; i++) {
            var t = (i / steps) * Math.PI * 2;
            var x = 16 * Math.pow(Math.sin(t), 3);
            var y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
            raw.push({ x: x, y: y });
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }

        var rangeX = maxX - minX;
        var rangeY = maxY - minY;
        var targetW = 1000;
        var targetH = Math.round((rangeY / rangeX) * targetW);

        var d = '';
        for (var j = 0; j < raw.length; j++) {
            var px = ((raw[j].x - minX) / rangeX) * targetW;
            var py = ((raw[j].y - minY) / rangeY) * targetH;
            d += (j === 0 ? 'M' : 'L') + px.toFixed(1) + ',' + py.toFixed(1);
            if (j < raw.length - 1) d += ' ';
        }
        return { d: d + ' Z', width: targetW, height: targetH };
    }

    var heartData = generateHeartPath();

    /* ------------------------------------------------------------------ *
     *  Shape registry
     *  Shape = {
     *    name, viewBox:{width,height},
     *    paths:[...]      — SVG paths (for built-in shapes & preview icons)
     *    maskCanvas?      — HTMLCanvasElement (for dynamic shapes, used by generateMask)
     *    dynamic?:bool
     *  }
     * ------------------------------------------------------------------ */
    var Shapes = {
        china: {
            name: '中国地图',
            viewBox: { width: 1000, height: 708.9 },
            paths: [
                'M597.6,699.2 L583.5,708.9 L570.2,702.7 L569.7,685.4 L577.7,676.2 L595.5,670.6 L604.9,671.1 L608.5,678.8 L601.4,687.6 L597.6,699.2 Z',
                'M879.9,74.4 L908.3,80.8 L927.6,95.1 L934.2,114 L958.9,114 L973.1,106.1 L1000,100.1 L991.4,118.2 L985.1,125.6 L979.5,147.6 L968.6,167.2 L948.8,163.6 L934.8,170.7 L939.1,187.9 L936.7,211.7 L928.4,212.2 L928.5,222.4 L918,210.6 L911.5,221.8 L886.3,230.5 L888.9,241.1 L874.8,240.4 L867,234.1 L855.8,248.3 L837.9,259.1 L824.6,272 L801.8,277.9 L789.8,287.3 L772.3,292.7 L780.9,283.4 L777.5,275.6 L790.4,262.1 L781.8,251.5 L767.6,258.6 L749.2,272.6 L739.2,285.6 L723.2,286.6 L714.9,296 L723.4,309.5 L736.8,312.8 L737.3,321.9 L750.2,327.7 L768.5,313.4 L783,321.2 L793.5,321.7 L796.2,332.3 L773.1,337.9 L765.5,348.7 L749.6,358.8 L741.2,372.9 L758.8,384 L765.2,403.7 L775.1,422.1 L786.2,437.6 L785.9,452.5 L775.7,458 L779.6,468.7 L789.2,475 L786.7,491.4 L782.5,507.3 L773.4,509.1 L761.5,530.9 L748.3,557.2 L733.2,581.2 L710.8,599.8 L688.1,616.7 L669.7,619 L659.8,627.9 L654.1,621.4 L644.9,631.4 L622.1,641.5 L604.9,644.6 L599.3,665.8 L590.3,667 L586,652.4 L589.9,644.6 L568,638.2 L560.3,641.4 L543.9,636.2 L536.1,628.1 L538.7,616.5 L523.8,612.8 L515.9,605.3 L502.1,616 L486.2,618.3 L473.2,618.2 L464.5,623.1 L456,626 L458.5,649 L449.8,648.5 L448.3,643.8 L447.8,635.5 L435.9,641.3 L428.8,637.6 L416.7,630.1 L421.5,613.4 L411.1,609.5 L407.2,591 L390,594.3 L392,570.4 L407.4,553.7 L408.1,537.1 L407.6,521.7 L400.5,516.9 L395,505.1 L385.5,506.6 L367.9,503.6 L373.4,495.1 L365.8,482.6 L354.2,491.1 L340.5,486.1 L321.7,498.9 L306.9,513.9 L293.7,516.4 L286.6,511 L278,510.5 L266.3,505.9 L257.5,511 L246.8,525.9 L245.4,510.1 L235.4,514.3 L216.4,512.3 L198,507.7 L184.8,498.9 L172.1,494.9 L166.6,485.3 L157.5,482.4 L141,469.3 L128,463.1 L121.2,467.9 L98.5,453.9 L82.5,441.1 L78,419 L89.7,421.7 L90.2,411.4 L83.7,401.1 L85.4,384.7 L67.8,361.2 L41,353 L36.2,337.6 L24.2,328.2 L21.3,322.4 L18.8,311 L19.4,303.2 L9.5,298.6 L4.1,300.6 L0,282 L4.6,277.4 L2.4,272.7 L18,263.2 L29.2,259.3 L46.5,262 L52.6,249.1 L73.5,246.7 L79.4,238.8 L105,227.9 L107.3,223.3 L106,211.9 L117.2,206.6 L102.5,171.7 L134.8,163.7 L143.2,159.2 L154.9,123.2 L187.3,129.8 L196.3,120.7 L197.1,100.6 L210.6,98.7 L223.1,85.3 L229.4,83.7 L233.7,97.7 L247.4,108.4 L270.7,115.9 L281.9,132.1 L275.6,155.6 L281.5,164.3 L300.9,167.7 L322.8,170.5 L342.5,183.1 L352.6,185.3 L360,203.8 L369.6,215.8 L387.5,215.3 L421.2,219.8 L442.9,217 L459,220 L483.1,232.2 L502.8,232.2 L510,238.5 L529,227.7 L555.3,220.7 L579.8,219.9 L598.8,212.9 L610.5,202.1 L621.9,195.3 L619.3,188.7 L614.1,181 L622.6,168 L631.8,169.8 L648.5,173.9 L664.8,163.2 L689.6,155.4 L701.6,142.1 L713.1,136.4 L736.7,133.8 L749.6,136 L751.4,128.9 L736.6,114.8 L723.5,108.4 L711,115.8 L694.9,112.7 L685.7,115.2 L681.5,107 L693,86.9 L700.9,71.8 L720.5,79.4 L743.5,66.7 L743.3,57.8 L758,36.5 L767.1,30 L766.9,18.9 L758,14.2 L771.4,4.2 L791.7,0.5 L813.3,0 L837.7,6 L852,13.4 L862.1,33.7 L868.2,42.3 L873.9,54.7 L879.9,74.4 Z'
            ]
        },
        heart: {
            name: '爱心',
            viewBox: { width: heartData.width, height: heartData.height },
            paths: [heartData.d]
        },
        portrait: {
            name: '人像',
            viewBox: { width: 1000, height: 1000 },
            paths: [
                'M500,50 C620,50 690,140 690,255 C690,325 655,375 620,405 L620,435 C685,445 760,475 820,545 C885,620 935,745 965,895 L975,1000 L25,1000 L35,895 C65,745 115,620 180,545 C240,475 315,445 380,435 L380,405 C345,375 310,325 310,255 C310,140 380,50 500,50 Z'
            ]
        }
    };

    /** Get list of shape keys. */
    Shapes.keys = function () {
        return Object.keys(Shapes).filter(function (k) {
            return typeof Shapes[k] === 'object' && Shapes[k].paths;
        });
    };

    /** Register a dynamic shape. */
    Shapes.register = function (key, shape) {
        Shapes[key] = shape;
    };

    /** Remove a dynamic shape. */
    Shapes.remove = function (key) {
        delete Shapes[key];
    };

    /* ================================================================== *
     *  ShapeFactory — generate shapes from text or custom images
     *
     *  Strategy: render to canvas → store maskCanvas directly (fast),
     *  + trace a TINY thumbnail for the preview icon.
     * ================================================================== */
    var ShapeFactory = {};

    /**
     * Generate a shape from text/word/number.
     * @returns {Promise<shape>}
     */
    ShapeFactory.fromText = function (text) {
        return new Promise(function (resolve, reject) {
            if (!text || !text.trim()) {
                reject(new Error('empty text'));
                return;
            }
            text = text.trim().slice(0, 12);

            setTimeout(function () {
                var fontSize = 250;
                var font = 'bold ' + fontSize + 'px Arial, Helvetica, sans-serif';

                var mCanvas = document.createElement('canvas');
                var mctx = mCanvas.getContext('2d');
                mctx.font = font;
                var metrics = mctx.measureText(text);
                var textW = metrics.width;
                var textH = fontSize * 1.2;

                var pad = 20;
                var canvasW = Math.ceil(textW + pad * 2);
                var canvasH = Math.ceil(textH + pad * 2);

                // Render the mask canvas (white = inside)
                var canvas = document.createElement('canvas');
                canvas.width = canvasW;
                canvas.height = canvasH;
                var ctx = canvas.getContext('2d');
                ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, canvasW, canvasH);
                ctx.fillStyle = '#fff';
                ctx.font = font;
                ctx.textBaseline = 'middle';
                ctx.textAlign = 'center';
                ctx.fillText(text, canvasW / 2, canvasH / 2);

                // Generate a tiny thumbnail path for preview icon (~80px wide)
                var thumbW = 80;
                var thumbH = Math.round(thumbW * canvasH / canvasW);
                var thumbCanvas = document.createElement('canvas');
                thumbCanvas.width = thumbW;
                thumbCanvas.height = thumbH;
                var tctx = thumbCanvas.getContext('2d');
                tctx.drawImage(canvas, 0, 0, thumbW, thumbH);
                var thumbData = tctx.getImageData(0, 0, thumbW, thumbH);
                var thumbPath = ShapeFactory._traceMask(thumbData);

                // Scale viewBox to ~1000 wide for consistency with built-in shapes
                var viewScale = 1000 / canvasW;

                resolve({
                    name: '"' + text + '"',
                    viewBox: {
                        width: Math.round(canvasW * viewScale),
                        height: Math.round(canvasH * viewScale)
                    },
                    paths: [thumbPath || 'M0,0 L1,0 L1,1 L0,1 Z'],
                    maskCanvas: canvas,
                    maskCanvasW: canvasW,
                    maskCanvasH: canvasH,
                    dynamic: true
                });
            }, 0);
        });
    };

    /**
     * Generate a shape from a custom image silhouette.
     * @returns {Promise<shape>}
     */
    ShapeFactory.createImageMask = function (img, options, maxDim) {
        options = options || {};
        maxDim = maxDim || 400;
        var threshold = Number(options.threshold === undefined ? 42 : options.threshold);
        var mode = options.mode || 'auto';
        var smooth = Math.max(0, Math.min(3, Number(options.smooth) || 0));
        var scale = Math.min(maxDim / img.naturalWidth, maxDim / img.naturalHeight, 1);
        var w = Math.max(1, Math.ceil(img.naturalWidth * scale));
        var h = Math.max(1, Math.ceil(img.naturalHeight * scale));
        var source = document.createElement('canvas');
        source.width = w; source.height = h;
        var sourceCtx = source.getContext('2d', { willReadFrequently: true });
        sourceCtx.drawImage(img, 0, 0, w, h);
        var imageData = sourceCtx.getImageData(0, 0, w, h);
        var data = imageData.data, total = w * h;
        var transparentCount = 0, borderR = 0, borderG = 0, borderB = 0, borderSamples = 0;

        for (var by = 0; by < h; by++) {
            for (var bx = 0; bx < w; bx++) {
                var bi = (by * w + bx) * 4;
                if (data[bi + 3] < 245) transparentCount++;
                if (by < 3 || by >= h - 3 || bx < 3 || bx >= w - 3) {
                    borderR += data[bi]; borderG += data[bi + 1]; borderB += data[bi + 2];
                    borderSamples++;
                }
            }
        }
        borderR /= Math.max(1, borderSamples);
        borderG /= Math.max(1, borderSamples);
        borderB /= Math.max(1, borderSamples);
        var useAlpha = mode === 'auto' && transparentCount > total * 0.01;
        var mask = new Uint8Array(total), detectedCount = 0;

        for (var i = 0; i < total; i++) {
            var p = i * 4, r = data[p], g = data[p + 1], b = data[p + 2], a = data[p + 3];
            var brightness = (r + g + b) / 3;
            var colourDistance = Math.sqrt(
                (r - borderR) * (r - borderR) +
                (g - borderG) * (g - borderG) +
                (b - borderB) * (b - borderB)
            ) / Math.sqrt(3);
            var inside;
            if (useAlpha) inside = a > threshold;
            else if (mode === 'threshold') inside = brightness < threshold;
            else inside = a > 40 && colourDistance > threshold;
            if (options.invert) inside = !inside && a > 15;
            mask[i] = inside ? 1 : 0;
            if (inside) detectedCount++;
        }

        if (detectedCount < total * 0.001) {
            for (var fallback = 0; fallback < total; fallback++) mask[fallback] = data[fallback * 4 + 3] > 40 ? 1 : 0;
        }
        if (options.keepLargest !== false) mask = ShapeFactory._keepLargestComponent(mask, w, h);
        for (var pass = 0; pass < smooth; pass++) mask = ShapeFactory._smoothMask(mask, w, h);

        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        var ctx = canvas.getContext('2d');
        var output = ctx.createImageData(w, h);
        for (var m = 0; m < total; m++) {
            var value = mask[m] ? 255 : 0, oi = m * 4;
            output.data[oi] = value; output.data[oi + 1] = value; output.data[oi + 2] = value; output.data[oi + 3] = 255;
        }
        ctx.putImageData(output, 0, 0);
        return { canvas: canvas, sourceCanvas: source, width: w, height: h, mask: mask };
    };

    ShapeFactory._keepLargestComponent = function (mask, w, h) {
        var visited = new Uint8Array(mask.length), queue = new Int32Array(mask.length);
        var best = [], directions = [-1, 1, -w, w];
        for (var start = 0; start < mask.length; start++) {
            if (!mask[start] || visited[start]) continue;
            var head = 0, tail = 0, component = [];
            queue[tail++] = start; visited[start] = 1;
            while (head < tail) {
                var current = queue[head++]; component.push(current);
                var x = current % w;
                for (var d = 0; d < directions.length; d++) {
                    if ((d === 0 && x === 0) || (d === 1 && x === w - 1)) continue;
                    var next = current + directions[d];
                    if (next >= 0 && next < mask.length && mask[next] && !visited[next]) {
                        visited[next] = 1; queue[tail++] = next;
                    }
                }
            }
            if (component.length > best.length) best = component;
        }
        var result = new Uint8Array(mask.length);
        for (var i = 0; i < best.length; i++) result[best[i]] = 1;
        return result;
    };

    ShapeFactory._smoothMask = function (mask, w, h) {
        var result = new Uint8Array(mask.length);
        for (var y = 0; y < h; y++) {
            for (var x = 0; x < w; x++) {
                var neighbours = 0, samples = 0;
                for (var oy = -1; oy <= 1; oy++) {
                    for (var ox = -1; ox <= 1; ox++) {
                        var nx = x + ox, ny = y + oy;
                        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                            samples++; neighbours += mask[ny * w + nx];
                        }
                    }
                }
                result[y * w + x] = neighbours >= Math.ceil(samples / 2) ? 1 : 0;
            }
        }
        return result;
    };

    ShapeFactory.fromImage = function (img, options) {
        return new Promise(function (resolve, reject) {
            setTimeout(function () {
                try {
                    if (typeof options === 'number') options = { threshold: options };
                    var result = ShapeFactory.createImageMask(img, options || {}, 400);
                    var canvas = result.canvas, w = result.width, h = result.height;
                    var thumbW = 80, thumbH = Math.max(1, Math.round(thumbW * h / w));
                    var thumbCanvas = document.createElement('canvas');
                    thumbCanvas.width = thumbW; thumbCanvas.height = thumbH;
                    var tctx = thumbCanvas.getContext('2d');
                    tctx.drawImage(canvas, 0, 0, thumbW, thumbH);
                    var thumbPath = ShapeFactory._traceMask(tctx.getImageData(0, 0, thumbW, thumbH));
                    var viewScale = 1000 / w;
                    resolve({
                        name: '自定义形状',
                        viewBox: { width: Math.round(w * viewScale), height: Math.round(h * viewScale) },
                        paths: [thumbPath || 'M0,0 L1,0 L1,1 L0,1 Z'],
                        maskCanvas: canvas, maskCanvasW: w, maskCanvasH: h, dynamic: true
                    });
                } catch (error) { reject(error); }
            }, 0);
        });
    };

    /* ------------------------------------------------------------------ *
     *  Boundary tracing — ONLY for small thumbnails (≤100px)
     * ------------------------------------------------------------------ */

    /**
     * Trace a binary mask (white=inside) into a simplified SVG path.
     * Uses Moore-neighbor boundary following + flood-fill visited marking.
     * Only suitable for small images (≤ ~100×100).
     */
    ShapeFactory._traceMask = function (imageData) {
        var w = imageData.width;
        var h = imageData.height;
        var data = imageData.data;

        function isInside(x, y) {
            if (x < 0 || x >= w || y < 0 || y >= h) return false;
            return data[(y * w + x) * 4] > 128;
        }

        var visited = new Uint8Array(w * h);
        var paths = [];

        for (var startY = 0; startY < h; startY++) {
            for (var startX = 0; startX < w; startX++) {
                var sIdx = startY * w + startX;
                if (visited[sIdx] || !isInside(startX, startY)) continue;

                // Only start from boundary pixels (have at least 1 outside neighbor)
                var isBoundary = false;
                for (var d = 0; d < 8; d++) {
                    var ddx = [1,1,0,-1,-1,-1,0,1][d];
                    var ddy = [0,1,1,1,0,-1,-1,-1][d];
                    if (!isInside(startX + ddx, startY + ddy)) {
                        isBoundary = true;
                        break;
                    }
                }
                if (!isBoundary) {
                    // Flood-fill mark all connected interior pixels as visited
                    ShapeFactory._floodFill(isInside, visited, w, h, startX, startY);
                    continue;
                }

                // Trace boundary
                var boundary = ShapeFactory._mooreTrace(isInside, visited, w, h, startX, startY);
                if (boundary.length < 4) continue;

                // Flood-fill the interior
                ShapeFactory._floodFill(isInside, visited, w, h, startX, startY);

                // Simplify
                var simplified = ShapeFactory._douglasPeucker(boundary, 1.5);
                if (simplified.length < 3) continue;

                var d2 = '';
                for (var k = 0; k < simplified.length; k++) {
                    d2 += (k === 0 ? 'M' : 'L') + simplified[k][0].toFixed(1) + ',' + simplified[k][1].toFixed(1);
                    if (k < simplified.length - 1) d2 += ' ';
                }
                d2 += ' Z';
                paths.push(d2);
            }
        }

        return paths.length > 0 ? paths.join(' ') : '';
    };

    /** Flood fill: mark all connected inside pixels as visited. */
    ShapeFactory._floodFill = function (isInside, visited, w, h, sx, sy) {
        var stack = [[sx, sy]];
        while (stack.length > 0) {
            var pt = stack.pop();
            var x = pt[0], y = pt[1];
            if (x < 0 || x >= w || y < 0 || y >= h) continue;
            var idx = y * w + x;
            if (visited[idx] || !isInside(x, y)) continue;
            visited[idx] = 1;
            stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
        }
    };

    /** Moore-neighborhood boundary tracing for one connected component. */
    ShapeFactory._mooreTrace = function (isInside, visited, w, h, sx, sy) {
        var dx = [1, 1, 0, -1, -1, -1, 0, 1];
        var dy = [0, 1, 1, 1, 0, -1, -1, -1];

        var boundary = [];
        var cx = sx, cy = sy;
        var prevDir = 7;
        var maxIter = w * h * 2;

        for (var iter = 0; iter < maxIter; iter++) {
            boundary.push([cx, cy]);
            visited[cy * w + cx] = 1;

            var found = false;
            for (var i = 0; i < 8; i++) {
                var dir = (prevDir + 6 + i) % 8;
                var nx = cx + dx[dir];
                var ny = cy + dy[dir];
                if (isInside(nx, ny)) {
                    cx = nx; cy = ny;
                    prevDir = dir;
                    found = true;
                    break;
                }
            }
            if (!found) break;
            if (cx === sx && cy === sy) break;
        }
        return boundary;
    };

    /** Douglas-Peucker line simplification. */
    ShapeFactory._douglasPeucker = function (points, epsilon) {
        if (points.length < 3) return points;

        function perpDist(p, a, b) {
            var dx = b[0] - a[0];
            var dy = b[1] - a[1];
            if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
            var t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
            t = Math.max(0, Math.min(1, t));
            var px = a[0] + t * dx;
            var py = a[1] + t * dy;
            return Math.hypot(p[0] - px, p[1] - py);
        }

        function simplify(pts, lo, hi, out) {
            if (lo >= hi) return;
            var maxDist = 0;
            var maxIdx = lo;
            for (var i = lo + 1; i < hi; i++) {
                var d = perpDist(pts[i], pts[lo], pts[hi]);
                if (d > maxDist) { maxDist = d; maxIdx = i; }
            }
            if (maxDist > epsilon) {
                simplify(pts, lo, maxIdx, out);
                out.push(pts[maxIdx]);
                simplify(pts, maxIdx, hi, out);
            }
        }

        var result = [points[0]];
        simplify(points, 0, points.length - 1, result);
        result.push(points[points.length - 1]);
        return result;
    };

    global.Shapes = Shapes;
    global.ShapeFactory = ShapeFactory;
})(window);
