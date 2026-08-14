/**
 * Extract lightweight colour, detail and focal-point metadata from pixels.
 * Keeping the pixel algorithm DOM-free makes it reusable from a Web Worker.
 */
export function analyzePixels(data, width, height, naturalWidth, naturalHeight) {
    var count = Math.max(1, width * height);
    var red = 0, green = 0, blue = 0, luminanceSum = 0;
    var luminance = new Float32Array(count);
    for (var i = 0; i < count; i++) {
        var offset = i * 4;
        red += data[offset];
        green += data[offset + 1];
        blue += data[offset + 2];
        var light = 0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2];
        luminance[i] = light;
        luminanceSum += light;
    }
    red = Math.round(red / count);
    green = Math.round(green / count);
    blue = Math.round(blue / count);
    var max = Math.max(red, green, blue), min = Math.min(red, green, blue);
    var delta = max - min, hue = 0;
    if (delta) {
        if (max === red) hue = 60 * (((green - blue) / delta) % 6);
        else if (max === green) hue = 60 * ((blue - red) / delta + 2);
        else hue = 60 * ((red - green) / delta + 4);
    }
    if (hue < 0) hue += 360;

    var meanLight = luminanceSum / count;
    var variance = 0, edgeTotal = 0, saliencyTotal = 0;
    var saliency = new Float32Array(count);
    var skinMask = new Uint8Array(count);
    for (var y = 0; y < height; y++) {
        for (var x = 0; x < width; x++) {
            var index = y * width + x;
            var difference = luminance[index] - meanLight;
            variance += difference * difference;
            var edge = 0;
            if (x) edge += Math.abs(luminance[index] - luminance[index - 1]);
            if (y) edge += Math.abs(luminance[index] - luminance[index - width]);
            edgeTotal += edge;
            var weight = edge * 1.7 + Math.abs(difference) * 0.42;
            saliency[index] = weight;
            saliencyTotal += weight;
            var pixel = index * 4;
            var pr = data[pixel], pg = data[pixel + 1], pb = data[pixel + 2];
            var colourMax = Math.max(pr, pg, pb), colourMin = Math.min(pr, pg, pb);
            skinMask[index] = pr > 75 && pg > 35 && pb > 18 && pr > pg && pr > pb &&
                colourMax - colourMin > 12 && Math.abs(pr - pg) > 8 ? 1 : 0;
        }
    }

    // Ignore low-information background pixels. The previous constant weight
    // on every pixel pulled virtually every focal point back to the centre.
    var saliencyMean = saliencyTotal / count;
    var saliencyThreshold = saliencyMean * 1.18;
    var focusWeight = 0, focusX = 0, focusY = 0;
    for (var sy = 0; sy < height; sy++) {
        for (var sx = 0; sx < width; sx++) {
            var saliencyIndex = sy * width + sx;
            var salientWeight = Math.max(0, saliency[saliencyIndex] - saliencyThreshold);
            if (!salientWeight) continue;
            focusWeight += salientWeight;
            focusX += (width > 1 ? sx / (width - 1) : 0.5) * salientWeight;
            focusY += (height > 1 ? sy / (height - 1) : 0.5) * salientWeight;
        }
    }
    var saliencyX = focusWeight ? focusX / focusWeight : 0.5;
    var saliencyY = focusWeight ? focusY / focusWeight : 0.5;

    // Find the strongest connected skin-tone region as an inexpensive,
    // offline person/face hint when the browser FaceDetector API is absent.
    var visited = new Uint8Array(count);
    var bestSkin = null;
    for (var start = 0; start < count; start++) {
        if (!skinMask[start] || visited[start]) continue;
        var queue = [start], cursor = 0, componentCount = 0, componentX = 0, componentY = 0, componentDetail = 0;
        var componentMinX = width, componentMinY = height, componentMaxX = 0, componentMaxY = 0;
        visited[start] = 1;
        while (cursor < queue.length) {
            var current = queue[cursor++];
            var cx = current % width, cy = Math.floor(current / width);
            componentCount++;
            componentX += cx;
            componentY += cy;
            componentDetail += saliency[current];
            componentMinX = Math.min(componentMinX, cx);
            componentMinY = Math.min(componentMinY, cy);
            componentMaxX = Math.max(componentMaxX, cx);
            componentMaxY = Math.max(componentMaxY, cy);
            var neighbours = [current - 1, current + 1, current - width, current + width];
            for (var neighbourIndex = 0; neighbourIndex < neighbours.length; neighbourIndex++) {
                var neighbour = neighbours[neighbourIndex];
                if (neighbour < 0 || neighbour >= count || visited[neighbour] || !skinMask[neighbour]) continue;
                var nx = neighbour % width;
                if (Math.abs(nx - cx) > 1) continue;
                visited[neighbour] = 1;
                queue.push(neighbour);
            }
        }
        if (componentCount < Math.max(3, count * 0.004)) continue;
        var componentFocusX = width > 1 ? componentX / componentCount / (width - 1) : 0.5;
        var componentFocusY = height > 1 ? componentY / componentCount / (height - 1) : 0.5;
        var centrality = 1 - Math.min(1, Math.hypot(componentFocusX - 0.5, componentFocusY - 0.45));
        var componentScore = componentCount * (1 + centrality * 0.2) + componentDetail / 255;
        if (!bestSkin || componentScore > bestSkin.score) {
            bestSkin = {
                x: componentFocusX, y: componentFocusY, count: componentCount, score: componentScore,
                minX: componentMinX, minY: componentMinY, maxX: componentMaxX, maxY: componentMaxY
            };
        }
    }
    var hasSubject = bestSkin && bestSkin.count / count >= 0.008;
    var detectedFocusX = hasSubject ? bestSkin.x * 0.82 + saliencyX * 0.18 : saliencyX;
    var detectedFocusY = hasSubject ? bestSkin.y * 0.82 + saliencyY * 0.18 : saliencyY;
    var faceBox = null, personBox = null;
    if (hasSubject) {
        faceBox = {
            x: Math.max(0, bestSkin.minX / width),
            y: Math.max(0, bestSkin.minY / height),
            width: Math.min(1, (bestSkin.maxX - bestSkin.minX + 1) / width),
            height: Math.min(1, (bestSkin.maxY - bestSkin.minY + 1) / height)
        };
        var personX = Math.max(0, faceBox.x - faceBox.width * 0.3);
        personBox = {
            x: personX,
            y: faceBox.y,
            width: Math.min(1 - personX, faceBox.width * 1.6),
            height: Math.min(1 - faceBox.y, faceBox.height * 2.8)
        };
    }
    return {
        r: red,
        g: green,
        b: blue,
        brightness: meanLight / 255,
        hue: hue,
        saturation: max ? delta / max : 0,
        contrast: Math.sqrt(variance / count) / 128,
        sharpness: edgeTotal / Math.max(1, count * 255 * 2),
        focusX: detectedFocusX,
        focusY: detectedFocusY,
        focusSource: hasSubject ? 'subject' : 'saliency',
        subjectScore: hasSubject ? Math.min(1, bestSkin.count / count * 4) : 0,
        subjectConfidence: hasSubject ? Math.min(0.62, 0.24 + bestSkin.count / count * 5) : 0,
        faceBox: faceBox,
        faceBoxes: faceBox ? [faceBox] : [],
        faceGroupBox: faceBox,
        faceCount: faceBox ? 1 : 0,
        personBox: personBox,
        aspectRatio: Math.max(1, naturalWidth || width) / Math.max(1, naturalHeight || height)
    };
}

export function analyzePhoto(img, sampleSize) {
    var size = Math.max(8, Number(sampleSize) || 48);
    var canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    var context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(img, 0, 0, size, size);
    return analyzePixels(
        context.getImageData(0, 0, size, size).data,
        size,
        size,
        img.naturalWidth,
        img.naturalHeight
    );
}
