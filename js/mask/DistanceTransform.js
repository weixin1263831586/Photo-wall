/**
 * Approximate Euclidean distance from every inside pixel to the mask boundary.
 * Outside pixels remain zero. Two chamfer passes keep this linear in mask size.
 */
export function computeDistanceTransform(mask, width, height) {
    var count = width * height;
    var distance = new Float32Array(count);
    var diagonal = Math.SQRT2;
    for (var i = 0; i < count; i++) distance[i] = mask[i] ? width + height : 0;

    for (var y = 0; y < height; y++) {
        for (var x = 0; x < width; x++) {
            var index = y * width + x;
            if (!mask[index]) continue;
            var best = distance[index];
            if (x) best = Math.min(best, distance[index - 1] + 1);
            if (y) best = Math.min(best, distance[index - width] + 1);
            if (x && y) best = Math.min(best, distance[index - width - 1] + diagonal);
            if (x + 1 < width && y) best = Math.min(best, distance[index - width + 1] + diagonal);
            distance[index] = best;
        }
    }
    for (var reverseY = height - 1; reverseY >= 0; reverseY--) {
        for (var reverseX = width - 1; reverseX >= 0; reverseX--) {
            var reverseIndex = reverseY * width + reverseX;
            if (!mask[reverseIndex]) continue;
            var reverseBest = distance[reverseIndex];
            if (reverseX + 1 < width) reverseBest = Math.min(reverseBest, distance[reverseIndex + 1] + 1);
            if (reverseY + 1 < height) reverseBest = Math.min(reverseBest, distance[reverseIndex + width] + 1);
            if (reverseX + 1 < width && reverseY + 1 < height) reverseBest = Math.min(reverseBest, distance[reverseIndex + width + 1] + diagonal);
            if (reverseX && reverseY + 1 < height) reverseBest = Math.min(reverseBest, distance[reverseIndex + width - 1] + diagonal);
            distance[reverseIndex] = reverseBest;
        }
    }
    return distance;
}

export function sampleDistance(distance, width, height, x, y) {
    var sampleX = Math.max(0, Math.min(width - 1, Math.round(x)));
    var sampleY = Math.max(0, Math.min(height - 1, Math.round(y)));
    return distance[sampleY * width + sampleX] || 0;
}
