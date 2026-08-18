import { analyzePixels } from '../image/PhotoAnalyzer.js';

self.addEventListener('message', async function (event) {
    var id = event.data && event.data.id;
    var bitmap = null;
    try {
        var blob = event.data && event.data.blob;
        if (!(blob instanceof Blob)) throw new Error('invalid image blob');
        try {
            bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
        } catch (_) {
            bitmap = await createImageBitmap(blob);
        }
        var size = 48;
        var canvas = new OffscreenCanvas(size, size);
        var context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(bitmap, 0, 0, size, size);
        var pixels = context.getImageData(0, 0, size, size).data;
        var analysis = analyzePixels(pixels, size, size, bitmap.width, bitmap.height);
        self.postMessage({ id: id, analysis: analysis });
    } catch (error) {
        self.postMessage({ id: id, error: error && error.message ? error.message : 'photo analysis failed' });
    } finally {
        if (bitmap && typeof bitmap.close === 'function') bitmap.close();
    }
});
