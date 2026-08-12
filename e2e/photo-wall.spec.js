import { test, expect } from '@playwright/test';
import { deflateSync } from 'node:zlib';

function pngPhoto(index) {
    var colour = [index * 53 % 256, index * 97 % 256, index * 149 % 256, 255];
    var width = 24, height = 18;
    var scanline = Buffer.alloc((width * 4 + 1) * height);
    for (var y = 0; y < height; y++) {
        var row = y * (width * 4 + 1);
        scanline[row] = 0;
        for (var x = 0; x < width; x++) {
            var offset = row + 1 + x * 4;
            scanline[offset] = colour[0];
            scanline[offset + 1] = colour[1];
            scanline[offset + 2] = colour[2];
            scanline[offset + 3] = colour[3];
        }
    }
    return {
        name: 'photo-' + index + '.png',
        mimeType: 'image/png',
        buffer: createPng(width, height, scanline)
    };
}

function crc32(buffer) {
    var crc = 0xffffffff;
    for (var i = 0; i < buffer.length; i++) {
        crc ^= buffer[i];
        for (var bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    var typeBuffer = Buffer.from(type);
    var result = Buffer.alloc(data.length + 12);
    result.writeUInt32BE(data.length, 0);
    typeBuffer.copy(result, 4);
    data.copy(result, 8);
    result.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), data.length + 8);
    return result;
}

function createPng(width, height, pixels) {
    var header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 6;
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(pixels)),
        chunk('IEND', Buffer.alloc(0))
    ]);
}

test.beforeEach(async function ({ page }) {
    await page.goto('/');
    await expect(page.locator('#wall-canvas')).toBeVisible();
});

test('uploads photos, marks a featured photo and toggles mixed sizing', async function ({ page }) {
    var photos = Array.from({ length: 10 }, function (_, index) { return pngPhoto(index); });
    await page.locator('#file-input').setInputFiles(photos);
    await expect(page.locator('#photo-count')).toHaveText('10');
    await expect(page.locator('.photo-card')).toHaveCount(10);
    await expect(page.locator('#mixed-size-toggle')).toBeChecked();

    var firstFeature = page.locator('.photo-feature').first();
    await firstFeature.click();
    await expect(firstFeature).toHaveAttribute('aria-pressed', 'true');

    await page.getByText('大小图混排', { exact: true }).click();
    await expect(page.locator('#mixed-size-toggle')).not.toBeChecked();
    await page.locator('#undo-btn').click();
    await expect(page.locator('#mixed-size-toggle')).toBeChecked();
});

test('opens the export dialog and updates common aspect ratio', async function ({ page }) {
    await page.locator('#file-input').setInputFiles([pngPhoto(1), pngPhoto(2), pngPhoto(3)]);
    await expect(page.locator('#export-btn')).toBeEnabled();
    await page.locator('#export-btn').click();
    await expect(page.locator('#export-dialog')).toHaveAttribute('aria-hidden', 'false');
    await page.getByRole('radio', { name: /3:4/ }).click({ force: true });
    await expect(page.locator('#export-preview-ratio')).toContainText('3:4');
    await expect(page.locator('#export-dimensions')).not.toHaveText('—');
    await page.locator('#export-close').click();
    await expect(page.locator('#export-dialog')).toHaveAttribute('aria-hidden', 'true');
});

test('uses the photo analysis worker when the browser supports it', async function ({ page }) {
    var workerRequested = false;
    page.on('worker', function (worker) {
        if (worker.url().includes('photo-analysis.worker.js')) workerRequested = true;
    });
    await page.reload();
    await page.locator('#file-input').setInputFiles([pngPhoto(4)]);
    await expect(page.locator('#photo-count')).toHaveText('1');
    await expect.poll(function () { return workerRequested; }).toBe(true);
});
