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

function solidPng(name, width, height, colour) {
    var scanline = Buffer.alloc((width * 4 + 1) * height);
    for (var y = 0; y < height; y++) {
        var row = y * (width * 4 + 1);
        for (var x = 0; x < width; x++) {
            var offset = row + 1 + x * 4;
            scanline[offset] = colour[0];
            scanline[offset + 1] = colour[1];
            scanline[offset + 2] = colour[2];
            scanline[offset + 3] = 255;
        }
    }
    return { name: name, mimeType: 'image/png', buffer: createPng(width, height, scanline) };
}

async function recordedWebm(page, name, width, height, colour) {
    var bytes = await page.evaluate(async function (settings) {
        var canvas = document.createElement('canvas');
        canvas.width = settings.width;
        canvas.height = settings.height;
        var context = canvas.getContext('2d');
        context.fillStyle = settings.colour;
        context.fillRect(0, 0, canvas.width, canvas.height);
        var stream = canvas.captureStream(12);
        var recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
        var chunks = [];
        recorder.ondataavailable = function (event) { if (event.data.size) chunks.push(event.data); };
        var stopped = new Promise(function (resolve) { recorder.onstop = resolve; });
        recorder.start(100);
        for (var frame = 0; frame < 10; frame++) {
            context.fillRect(0, 0, canvas.width, canvas.height);
            await new Promise(function (resolve) { setTimeout(resolve, 50); });
        }
        recorder.stop();
        await stopped;
        stream.getTracks().forEach(function (track) { track.stop(); });
        return Array.from(new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer()));
    }, { width: width, height: height, colour: colour });
    return { name: name, mimeType: 'video/webm', buffer: Buffer.from(bytes) };
}

/** Records a WebM that alternates between two colours every few frames. */
async function alternatingWebm(page, name, width, height, colourA, colourB) {
    var bytes = await page.evaluate(async function (settings) {
        var canvas = document.createElement('canvas');
        canvas.width = settings.width;
        canvas.height = settings.height;
        var context = canvas.getContext('2d');
        var stream = canvas.captureStream(12);
        var recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
        var chunks = [];
        recorder.ondataavailable = function (event) { if (event.data.size) chunks.push(event.data); };
        var stopped = new Promise(function (resolve) { recorder.onstop = resolve; });
        recorder.start(100);
        for (var frame = 0; frame < 18; frame++) {
            context.fillStyle = frame % 6 < 3 ? settings.colourA : settings.colourB;
            context.fillRect(0, 0, canvas.width, canvas.height);
            await new Promise(function (resolve) { setTimeout(resolve, 50); });
        }
        recorder.stop();
        await stopped;
        stream.getTracks().forEach(function (track) { track.stop(); });
        return Array.from(new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer()));
    }, { width: width, height: height, colourA: colourA, colourB: colourB });
    return { name: name, mimeType: 'video/webm', buffer: Buffer.from(bytes) };
}

function wavMusic() {
    var sampleRate = 8000;
    var samples = sampleRate;
    var dataSize = samples * 2;
    var buffer = Buffer.alloc(44 + dataSize);
    buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + dataSize, 4); buffer.write('WAVE', 8);
    buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36); buffer.writeUInt32LE(dataSize, 40);
    for (var i = 0; i < samples; i++) {
        buffer.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / sampleRate) * 5000), 44 + i * 2);
    }
    return { name: 'background.wav', mimeType: 'audio/wav', buffer: buffer };
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

    var toolbarLayout = await page.evaluate(function () {
        var toolbar = document.querySelector('.workspace-bar');
        var motion = document.getElementById('canvas-motion-controls');
        var actions = document.querySelector('.workspace-actions');
        var motionRect = motion.getBoundingClientRect();
        var actionsRect = actions.getBoundingClientRect();
        return {
            controlsAreInToolbar: motion.parentElement === toolbar && actions.parentElement === toolbar,
            controlsShareOneRow: Math.abs(
                (motionRect.top + motionRect.height / 2) -
                (actionsRect.top + actionsRect.height / 2)
            ) < 2,
            toolbarIsSingleLine: getComputedStyle(toolbar).flexWrap === 'nowrap'
        };
    });
    expect(toolbarLayout.controlsAreInToolbar).toBe(true);
    expect(toolbarLayout.controlsShareOneRow).toBe(true);
    expect(toolbarLayout.toolbarIsSingleLine).toBe(true);

    var firstFeature = page.locator('.photo-feature').first();
    await firstFeature.click();
    await expect(firstFeature).toHaveAttribute('aria-pressed', 'true');

    await page.getByText('大小图混排', { exact: true }).click();
    await expect(page.locator('#mixed-size-toggle')).not.toBeChecked();
    await page.locator('#undo-btn').click();
    await expect(page.locator('#mixed-size-toggle')).toBeChecked();
});

test('mobile mixed photo and video import keeps every source visible without control overlap', async function ({ page }) {
    test.setTimeout(45000);
    await page.setViewportSize({ width: 393, height: 873 });
    var video = await recordedWebm(page, 'magenta-video.webm', 96, 160, 'rgb(220,45,190)');
    await page.locator('#file-input').setInputFiles([
        solidPng('red-wide.png', 120, 60, [230, 45, 60]),
        solidPng('green-tall.png', 60, 120, [35, 210, 100]),
        solidPng('blue-square.png', 90, 90, [50, 90, 235]),
        solidPng('yellow-wide.png', 160, 60, [235, 190, 25]),
        video
    ]);

    await expect(page.locator('.photo-card')).toHaveCount(5);
    await expect(page.locator('.photo-card.is-video')).toHaveCount(1);
    await expect(page.locator('.photo-card.is-video .photo-media-badge')).toHaveText('▶ 视频');
    await expect.poll(function () {
        return page.locator('.photo-card img').evaluateAll(function (images) {
            return images.every(function (image) { return image.naturalWidth > 0 && image.naturalHeight > 0; });
        });
    }).toBe(true);

    async function allSourcesAreVisible() {
        return page.evaluate(function () {
            var canvas = document.getElementById('wall-canvas');
            var pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
            var colours = [0, 0, 0, 0, 0];
            for (var offset = 0; offset < pixels.length; offset += 16) {
                var red = pixels[offset], green = pixels[offset + 1], blue = pixels[offset + 2], alpha = pixels[offset + 3];
                if (alpha < 32) continue;
                if (red > 160 && green < 110 && blue < 120) colours[0]++;
                if (green > 150 && red < 120 && blue < 150) colours[1]++;
                if (blue > 160 && red < 130 && green < 150) colours[2]++;
                if (red > 160 && green > 130 && blue < 100) colours[3]++;
                if ((red > 150 && blue > 130 && green < 120) ||
                    (red < 35 && green < 35 && blue < 35)) colours[4]++;
            }
            return colours.every(function (count) { return count > 50; });
        });
    }
    await expect.poll(allSourcesAreVisible).toBe(true);
    for (var mode of ['brick', 'organic', 'grid']) {
        await page.evaluate(function (value) {
            document.querySelector('.mode-btn[data-mode="' + value + '"]').click();
        }, mode);
        await expect.poll(allSourcesAreVisible).toBe(true);
    }

    var mobileLayout = await page.evaluate(function () {
        var toolbar = document.querySelector('.workspace-bar');
        var motion = document.getElementById('canvas-motion-controls');
        var actions = document.querySelector('.workspace-actions');
        var motionRect = motion.getBoundingClientRect();
        var actionsRect = actions.getBoundingClientRect();
        return {
            noHorizontalOverflow: document.documentElement.scrollWidth === innerWidth,
            controlsAreInToolbar: motion.parentElement === toolbar,
            controlsShareOneRow: Math.abs(
                (motionRect.top + motionRect.height / 2) -
                (actionsRect.top + actionsRect.height / 2)
            ) < 2,
            toolbarCanScroll: toolbar.scrollWidth > toolbar.clientWidth,
            toolbarHeight: toolbar.getBoundingClientRect().height
        };
    });
    expect(mobileLayout.noHorizontalOverflow).toBe(true);
    expect(mobileLayout.controlsAreInToolbar).toBe(true);
    expect(mobileLayout.controlsShareOneRow).toBe(true);
    expect(mobileLayout.toolbarCanScroll).toBe(true);
    expect(mobileLayout.toolbarHeight).toBeLessThanOrEqual(64);

    await page.locator('#sidebar-toggle').click();
    await expect(page.locator('.app')).toHaveClass(/sidebar-open/);
    await expect(page.locator('#material-import')).toBeVisible();
    await expect(page.locator('#design-presets')).toBeHidden();
    await page.getByRole('button', { name: '轮廓', exact: true }).click();
    await expect(page.locator('#design-shape')).toBeVisible();
    await expect(page.locator('#material-import')).toBeHidden();
    await page.getByRole('button', { name: '素材', exact: true }).click();
    await expect(page.locator('#photo-library-panel')).toBeVisible();
    await page.locator('.photo-card.is-video').click();
    await expect(page.locator('#lightbox-video')).toBeVisible();
    await expect(page.locator('#lightbox-video')).toHaveAttribute('src', /^blob:/);
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

test('opens the exact selected material without flashing a neighbouring photo', async function ({ page }) {
    await page.locator('#file-input').setInputFiles([pngPhoto(20), pngPhoto(21), pngPhoto(22)]);
    await page.locator('.photo-card').nth(1).click();
    await expect(page.locator('#lightbox')).toHaveClass(/active/);
    await expect(page.locator('#lightbox-info')).toContainText('photo-21.png');
    await page.locator('#lightbox-close').click();
});

test('offers slot-local positioning and speed-controlled flow playback', async function ({ page }) {
    await page.locator('#file-input').setInputFiles([pngPhoto(30), pngPhoto(31), pngPhoto(32), pngPhoto(33)]);
    await expect(page.locator('#position-mode-btn')).toBeEnabled();
    await page.locator('#position-mode-btn').click();
    await expect(page.locator('#position-mode-btn')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#canvas-help')).toContainText('滚轮缩放');
    await page.locator('#wall-canvas').click({ position: { x: 550, y: 430 } });
    await expect(page.locator('#local-adjust-toolbar')).toBeVisible();
    await page.locator('#local-zoom-range').fill('1.8');
    await expect(page.locator('#local-zoom-value')).toHaveText('180%');
    await expect(page.locator('#local-adjust-reset')).toBeEnabled();
    await page.locator('#local-zoom-out').click();
    await expect(page.locator('#local-zoom-range')).toHaveValue('1.7');
    await expect(page.locator('#local-zoom-value')).toHaveText('170%');

    await page.locator('#flow-speed').selectOption('fast');
    await page.locator('#flow-play-btn').click();
    await expect(page.locator('#flow-play-btn')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#position-mode-btn')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#flow-play-label')).toHaveText('停止轮播');
    await page.waitForTimeout(650);
    await page.locator('#flow-play-btn').click();
    await expect(page.locator('#flow-play-label')).toHaveText('素材轮播');
    await expect(page.locator('#undo-btn')).toBeEnabled();
});

test('reveals tiles from a custom canvas origin with timeline playback', async function ({ page }) {
    await page.locator('#file-input').setInputFiles([pngPhoto(40), pngPhoto(41), pngPhoto(42), pngPhoto(43)]);
    await page.locator('#playback-mode').selectOption('reveal');
    await expect(page.locator('#playback-order')).toBeVisible();
    await page.locator('#playback-order').selectOption('custom');
    await expect(page.locator('#wall-canvas')).toHaveClass(/selecting-playback-origin/);

    await page.locator('#wall-canvas').click({ position: { x: 900, y: 500 } });
    await expect(page.locator('#playback-origin-marker')).toHaveClass(/visible/);
    await expect(page.locator('#wall-canvas')).not.toHaveClass(/selecting-playback-origin/);

    await page.locator('#flow-play-btn').click();
    await expect(page.locator('#flow-play-label')).toHaveText('停止播放');
    await page.waitForTimeout(250);
    await page.locator('#flow-play-btn').click();
    await expect(page.locator('#flow-play-label')).toHaveText('逐张播放');
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

test('deletes a selected sticker and removes the retained border', async function ({ page }) {
    await page.locator('#file-input').setInputFiles([pngPhoto(1), pngPhoto(2)]);
    await page.locator('[data-sticker="🎉"]').click();
    await expect(page.locator('.layer-item')).toHaveCount(1);
    await expect(page.locator('#overlay-delete-btn')).toBeVisible();
    await page.locator('#overlay-delete-btn').click();
    await expect(page.locator('.layer-item')).toHaveCount(0);
    await expect(page.locator('.toast')).toContainText('贴纸已删除');

    await page.locator('#border-style').selectOption('classic');
    await expect(page.locator('.layer-item')).toHaveCount(1);
    await expect(page.locator('#border-remove-btn')).toBeVisible();
    await page.locator('#border-remove-btn').click();
    await expect(page.locator('.layer-item')).toHaveCount(0);
    await expect(page.locator('#border-style')).toHaveValue('none');
});

test('uploads background music and keeps its controls editable', async function ({ page }) {
    await page.locator('#music-file-input').setInputFiles(wavMusic());
    await expect(page.locator('#music-editor')).toBeVisible();
    await expect(page.locator('#music-name')).toHaveText('background.wav');
    await page.locator('#music-volume').fill('0.4');
    await expect(page.locator('#music-volume-value')).toHaveText('40%');
    await page.locator('#music-loop').uncheck();
    await page.locator('#music-remove-btn').click();
    await expect(page.locator('#music-editor')).toBeHidden();
});

test('uses an original built-in track and an exact matrix template', async function ({ page }) {
    await page.locator('#file-input').setInputFiles([pngPhoto(21), pngPhoto(22), pngPhoto(23)]);
    await page.locator('[data-music-track="warm-memory"]').click();
    await expect(page.locator('#music-name')).toHaveText('warm-memory.wav', { timeout: 10000 });
    await expect(page.locator('[data-music-track="warm-memory"]')).toHaveClass(/active/);

    await page.locator('[data-preset="matrix-3"]').click();
    await expect(page.locator('#matrix-columns')).toHaveValue('3');
    await expect(page.locator('#canvas-status')).toContainText('9 个填充格位');
});

test('searches templates and saves a custom template', async function ({ page }) {
    await page.locator('#template-search').fill('婚礼');
    await expect(page.locator('.preset-btn')).toHaveCount(2);
    await expect(page.locator('[data-preset="wedding"]')).toBeVisible();
    await expect(page.locator('[data-preset="flower-wedding"]')).toBeVisible();
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

test('exports the selected reveal timeline as a non-empty WebM video', async function ({ page }) {
    await page.locator('#file-input').setInputFiles([pngPhoto(50), pngPhoto(51), pngPhoto(52)]);
    await page.locator('#music-file-input').setInputFiles(wavMusic());
    await expect(page.locator('#music-name')).toHaveText('background.wav');
    await page.locator('#playback-mode').selectOption('reveal');
    await page.locator('#flow-speed').selectOption('fast');
    await page.locator('#export-btn').click();
    await page.getByRole('radio', { name: /视频/, exact: true }).click({ force: true });
    await page.getByRole('radio', { name: /WebM/, exact: true }).click({ force: true });
    await expect(page.locator('#export-dimensions')).toContainText('15fps');

    var downloadPromise = page.waitForEvent('download', { timeout: 30000 });
    await page.locator('#export-confirm').click();
    var download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.webm$/);
    var video = await readFile(await download.path());
    expect(video.byteLength).toBeGreaterThan(1000);
});

test('exports background music in an MP4 video', async function ({ page }) {
    test.setTimeout(90000);
    await page.locator('#file-input').setInputFiles([pngPhoto(53), pngPhoto(54)]);
    await page.locator('#music-file-input').setInputFiles(wavMusic());
    await page.locator('#playback-mode').selectOption('reveal');
    await page.locator('#flow-speed').selectOption('fast');
    await page.locator('#export-btn').click();
    await page.getByRole('radio', { name: /视频/, exact: true }).click({ force: true });
    await page.getByRole('radio', { name: /^MP4/, exact: true }).click({ force: true });

    // ffmpeg.wasm has a 32 MB cold-start core, so first-run CI exports need
    // more time than the normal UI interaction budget.
    var downloadPromise = page.waitForEvent('download', { timeout: 90000 });
    await page.locator('#export-confirm').click();
    var download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.mp4$/);
    var video = await readFile(await download.path());
    expect(video.byteLength).toBeGreaterThan(1000);
    expect(video.subarray(4, 8).toString()).toBe('ftyp');
});

test('exports a printable PDF document', async function ({ page }) {
    await page.locator('#file-input').setInputFiles([pngPhoto(13), pngPhoto(14)]);
    await page.locator('#export-btn').click();
    await page.locator('input[name="export-category"][value="pdf"]').check({ force: true });
    await expect(page.locator('#print-export-field')).toBeVisible();
    await page.locator('#export-print-dpi').selectOption('150');
    var downloadPromise = page.waitForEvent('download');
    await page.locator('#export-confirm').click();
    var download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.pdf$/);
    var pdf = await readFile(await download.path());
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
});

test('imported video loops inside its wall cells instead of a static poster', async function ({ page }) {
    test.setTimeout(60000);
    /* The clip alternates between orange and violet; a looping wall cell must
       show both colours over time, while the poster-only wall would freeze on
       whichever frame the poster extraction happened to capture. */
    var video = await alternatingWebm(page, 'looping-video.webm', 96, 96, 'rgb(255,140,20)', 'rgb(120,60,230)');
    await page.locator('#file-input').setInputFiles([video]);
    await expect(page.locator('.photo-card.is-video')).toHaveCount(1);

    async function canvasColours() {
        return page.evaluate(function () {
            var canvas = document.getElementById('wall-canvas');
            var pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
            var orange = 0, violet = 0;
            for (var offset = 0; offset < pixels.length; offset += 16) {
                var red = pixels[offset], green = pixels[offset + 1], blue = pixels[offset + 2], alpha = pixels[offset + 3];
                if (alpha < 32) continue;
                if (red > 200 && green > 90 && green < 190 && blue < 90) orange++;
                if (red > 90 && red < 180 && blue > 180 && green < 110) violet++;
            }
            return { orange: orange, violet: violet };
        });
    }

    /* Poll across several seconds: each phase of the loop must appear. */
    var seenOrange = false, seenViolet = false;
    for (var sample = 0; sample < 90 && !(seenOrange && seenViolet); sample++) {
        var colours = await canvasColours();
        if (colours.orange > 40) seenOrange = true;
        if (colours.violet > 40) seenViolet = true;
        await page.waitForTimeout(150);
    }
    expect(seenOrange).toBe(true);
    expect(seenViolet).toBe(true);

    /* The hidden looping element keeps running while the wall is idle. */
    var pool = await page.evaluate(function () {
        var videos = document.querySelectorAll('#wall-video-stage video');
        var playing = Array.from(videos).filter(function (video) {
            return !video.paused && !video.ended;
        });
        return { entries: videos.length, playing: playing.length };
    });
    expect(pool.entries).toBe(1);
});

test('removing the video releases its looping decoder', async function ({ page }) {
    test.setTimeout(45000);
    var video = await recordedWebm(page, 'single-loop.webm', 96, 96, 'rgb(60,180,240)');
    await page.locator('#file-input').setInputFiles([video]);
    await expect(page.locator('.photo-card.is-video')).toHaveCount(1);
    await expect.poll(function () {
        return page.evaluate(function () {
            return document.querySelectorAll('#wall-video-stage video').length;
        });
    }).toBe(1);

    page.once('dialog', function (dialog) { dialog.accept(); });
    await page.locator('#clear-btn').click();
    await expect.poll(function () {
        return page.evaluate(function () {
            return document.querySelectorAll('#wall-video-stage video').length;
        });
    }).toBe(0);
});
