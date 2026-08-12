import { test, expect } from '@playwright/test';
import { deflateSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';

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

test('applies a product preset and restores the previous layout with undo', async function ({ page }) {
    await page.locator('#file-input').setInputFiles([
        pngPhoto(1), pngPhoto(2), pngPhoto(3), pngPhoto(4), pngPhoto(5)
    ]);
    var weddingPreset = page.locator('[data-preset="wedding"]');
    await weddingPreset.click();

    await expect(weddingPreset).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-shape="doubleHeart"]')).toHaveClass(/active/);
    await expect(page.locator('[data-mode="organic"]')).toHaveClass(/active/);
    await expect(page.locator('[data-pshape="circle"]')).toHaveClass(/active/);
    await expect(page.locator('#density-value')).toHaveText('90%');
    await expect(page.locator('#rotation-value')).toHaveText('3°');

    await page.locator('#undo-btn').click();
    await expect(page.locator('[data-shape="china"]')).toHaveClass(/active/);
    await expect(weddingPreset).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#photo-count')).toHaveText('5');
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

test('autosaves photos in IndexedDB and restores them after reload', async function ({ page }) {
    await page.locator('#file-input').setInputFiles([pngPhoto(7), pngPhoto(8)]);
    await expect(page.locator('#photo-count')).toHaveText('2');

    await expect.poll(function () {
        return page.evaluate(function () {
            return new Promise(function (resolve) {
                var request = indexedDB.open('photo-wall-autosave');
                request.onerror = function () { resolve(0); };
                request.onsuccess = function () {
                    var database = request.result;
                    if (!database.objectStoreNames.contains('projects')) {
                        database.close();
                        resolve(0);
                        return;
                    }
                    var transaction = database.transaction('projects', 'readonly');
                    var getRequest = transaction.objectStore('projects').get('latest');
                    getRequest.onerror = function () { resolve(0); };
                    getRequest.onsuccess = function () {
                        var record = getRequest.result;
                        database.close();
                        resolve(record && record.project ? record.project.photos.length : 0);
                    };
                };
            });
        });
    }).toBe(2);

    page.once('dialog', function (dialog) { return dialog.accept(); });
    await page.reload();
    await expect(page.locator('#photo-count')).toHaveText('2');
    await expect(page.locator('.photo-card')).toHaveCount(2);
});

test('edits one photo and restores the edit with undo', async function ({ page }) {
    await page.locator('#file-input').setInputFiles([pngPhoto(9), pngPhoto(10)]);
    await page.locator('.photo-edit').first().click();
    await expect(page.locator('#photo-editor')).toHaveClass(/active/);
    await page.locator('#photo-edit-zoom').fill('1.6');
    await page.locator('#photo-edit-rotation').fill('30');
    await page.locator('#photo-edit-flip-x').click();
    await page.locator('#photo-editor-confirm').click();
    await expect(page.locator('#photo-editor')).not.toHaveClass(/active/);
    await expect(page.locator('#undo-btn')).toBeEnabled();
    await page.locator('#undo-btn').click();
    await expect(page.locator('#photo-count')).toHaveText('2');
});

test('adds editable layers and generates a repeatable next layout option', async function ({ page }) {
    await page.locator('#file-input').setInputFiles([pngPhoto(1), pngPhoto(2), pngPhoto(3)]);
    await page.locator('#add-title-btn').click();
    await expect(page.locator('.layer-item')).toHaveCount(1);
    await page.locator('#overlay-content').fill('毕业快乐');
    await page.locator('#overlay-content').press('Tab');
    await expect(page.locator('.layer-item-name')).toContainText('毕业快乐');
    await page.locator('#border-style').selectOption('double');
    await expect(page.locator('.layer-item')).toHaveCount(2);
    await page.locator('#shuffle-btn').click();
    await expect(page.locator('.toast')).toContainText('已生成新方案');
});

test('searches templates and saves a custom template', async function ({ page }) {
    await page.locator('#template-search').fill('婚礼');
    await expect(page.locator('.preset-btn')).toHaveCount(1);
    await page.locator('#template-search').fill('');
    page.once('dialog', function (dialog) { return dialog.accept('我的婚礼版式'); });
    await page.locator('#save-template-btn').click();
    await expect(page.locator('[data-preset^="custom-template-"]')).toHaveCount(1);
});

test('round-trips a ZIP v2 project with its content layers', async function ({ page }) {
    await page.locator('#file-input').setInputFiles([pngPhoto(11), pngPhoto(12)]);
    await page.locator('#add-title-btn').click();
    await page.locator('#overlay-content').fill('项目标题');
    await page.locator('#overlay-content').press('Tab');
    var downloadPromise = page.waitForEvent('download');
    await page.locator('#save-project-btn').click();
    var download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.photowall$/);
    var projectPath = await download.path();
    var bytes = await readFile(projectPath);
    expect(bytes.subarray(0, 2).toString()).toBe('PK');

    page.once('dialog', function (dialog) { return dialog.accept(); });
    await page.locator('#clear-btn').click();
    await expect(page.locator('#photo-count')).toHaveText('0');
    await page.locator('#project-file-input').setInputFiles(projectPath);
    await expect(page.locator('#photo-count')).toHaveText('2');
    await expect(page.locator('.layer-item-name')).toContainText('项目标题');
});

test('exports a printable PDF document', async function ({ page }) {
    await page.locator('#file-input').setInputFiles([pngPhoto(13), pngPhoto(14)]);
    await page.locator('#export-btn').click();
    await page.locator('input[name="export-format"][value="pdf"]').check({ force: true });
    await expect(page.locator('#print-export-field')).toBeVisible();
    await page.locator('#export-print-dpi').selectOption('150');
    var downloadPromise = page.waitForEvent('download');
    await page.locator('#export-confirm').click();
    var download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.pdf$/);
    var pdf = await readFile(await download.path());
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
});
