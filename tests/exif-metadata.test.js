import test from 'node:test';
import assert from 'node:assert/strict';
import { parseExifCaptureTime, readCaptureTime } from '../js/image/ExifMetadata.js';

function jpegWithDate(dateText) {
    var date = dateText + '\0';
    var tiffLength = 8 + 2 + 12 + 4 + date.length;
    var payload = new Uint8Array(6 + tiffLength);
    payload.set([0x45, 0x78, 0x69, 0x66, 0, 0], 0);
    var view = new DataView(payload.buffer);
    var base = 6;
    view.setUint16(base, 0x4949, false);
    view.setUint16(base + 2, 42, true);
    view.setUint32(base + 4, 8, true);
    view.setUint16(base + 8, 1, true);
    view.setUint16(base + 10, 0x9003, true);
    view.setUint16(base + 12, 2, true);
    view.setUint32(base + 14, date.length, true);
    view.setUint32(base + 18, 26, true);
    for (var i = 0; i < date.length; i++) payload[base + 26 + i] = date.charCodeAt(i);
    view.setUint32(base + 22, 0, true);

    var jpeg = new Uint8Array(payload.length + 8);
    jpeg.set([0xff, 0xd8, 0xff, 0xe1], 0);
    new DataView(jpeg.buffer).setUint16(4, payload.length + 2, false);
    jpeg.set(payload, 6);
    jpeg.set([0xff, 0xd9], jpeg.length - 2);
    return jpeg.buffer;
}

test('reads DateTimeOriginal from JPEG EXIF metadata', function () {
    assert.equal(parseExifCaptureTime(jpegWithDate('2024:07:06 05:04:03')), '2024-07-06T05:04:03.000Z');
});

test('capture time falls back to file lastModified', async function () {
    var timestamp = Date.UTC(2023, 1, 2, 3, 4, 5);
    var file = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    Object.defineProperty(file, 'lastModified', { value: timestamp });
    assert.equal(await readCaptureTime(file), new Date(timestamp).toISOString());
});
