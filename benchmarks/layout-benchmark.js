import { performance } from 'node:perf_hooks';
import { assignPhotosToCells } from '../js/layout/SmartPlacement.js';

function run(count) {
    var photos = Array.from({ length: count }, function (_, index) {
        return {
            id: index, hue: index * 137.5 % 360, aspectRatio: 0.5 + index % 7 * 0.3,
            sharpness: index % 10 / 20, contrast: index % 8 / 10,
            focusX: index % 5 / 4, focusY: index % 3 / 2, featured: index % 97 === 0
        };
    });
    var columns = Math.ceil(Math.sqrt(count * 4 / 3));
    var cells = Array.from({ length: count }, function (_, index) {
        var row = Math.floor(index / columns), col = index % columns;
        return { x: col * 50, y: row * 50, width: index % 10 === 0 ? 100 : 50, height: 50, isLarge: index % 10 === 0, boundaryDistance: 25 };
    });
    var start = performance.now();
    assignPhotosToCells(photos, cells, { width: columns * 50, height: Math.ceil(count / columns) * 50 });
    return performance.now() - start;
}

console.log('Smart placement benchmark');
[100, 500, 1000].forEach(function (count) {
    var elapsed = run(count);
    console.log(String(count).padStart(4) + ' photos: ' + elapsed.toFixed(1) + ' ms');
});
