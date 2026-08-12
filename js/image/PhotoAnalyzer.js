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
    var variance = 0, edgeTotal = 0, focusWeight = 0, focusX = 0, focusY = 0;
    for (var y = 0; y < height; y++) {
        for (var x = 0; x < width; x++) {
            var index = y * width + x;
            var difference = luminance[index] - meanLight;
            variance += difference * difference;
            var edge = 0;
            if (x) edge += Math.abs(luminance[index] - luminance[index - 1]);
            if (y) edge += Math.abs(luminance[index] - luminance[index - width]);
            edgeTotal += edge;
            var weight = 1 + edge + Math.abs(difference) * 0.3;
            focusWeight += weight;
            focusX += (width > 1 ? x / (width - 1) : 0.5) * weight;
            focusY += (height > 1 ? y / (height - 1) : 0.5) * weight;
        }
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
        focusX: focusWeight ? focusX / focusWeight : 0.5,
        focusY: focusWeight ? focusY / focusWeight : 0.5,
        aspectRatio: Math.max(1, naturalWidth || width) / Math.max(1, naturalHeight || height)
    };
}

export function analyzePhoto(img, sampleSize) {
    var size = Math.max(8, Number(sampleSize) || 24);
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
