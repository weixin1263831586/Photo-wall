function readAscii(view, offset, length) {
    if (offset < 0 || offset + length > view.byteLength) return '';
    var value = '';
    for (var index = 0; index < length; index++) {
        var code = view.getUint8(offset + index);
        if (!code) break;
        value += String.fromCharCode(code);
    }
    return value;
}

function parseExifDate(value) {
    var match = String(value || '').match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (!match) return 0;
    var timestamp = Date.UTC(
        Number(match[1]), Number(match[2]) - 1, Number(match[3]),
        Number(match[4]), Number(match[5]), Number(match[6])
    );
    return Number.isFinite(timestamp) ? timestamp : 0;
}

function readIfd(view, tiffOffset, ifdOffset, littleEndian) {
    var result = { date: 0, exifOffset: 0 };
    var absolute = tiffOffset + ifdOffset;
    if (absolute < tiffOffset || absolute + 2 > view.byteLength) return result;
    var count = view.getUint16(absolute, littleEndian);
    for (var index = 0; index < count; index++) {
        var entry = absolute + 2 + index * 12;
        if (entry + 12 > view.byteLength) break;
        var tag = view.getUint16(entry, littleEndian);
        var type = view.getUint16(entry + 2, littleEndian);
        var size = view.getUint32(entry + 4, littleEndian);
        var rawOffset = size <= 4 ? entry + 8 : tiffOffset + view.getUint32(entry + 8, littleEndian);
        if (tag === 0x8769) result.exifOffset = view.getUint32(entry + 8, littleEndian);
        if ((tag === 0x9003 || tag === 0x9004 || tag === 0x0132) && type === 2 && size >= 19) {
            result.date = parseExifDate(readAscii(view, rawOffset, Math.min(size, 32))) || result.date;
            if (tag === 0x9003 && result.date) return result;
        }
    }
    return result;
}

/** Parse DateTimeOriginal from a JPEG APP1 Exif block without third-party code. */
export function parseExifCaptureTime(buffer) {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 16) return 0;
    var view = new DataView(buffer);
    if (view.getUint16(0, false) !== 0xffd8) return 0;
    var offset = 2;
    while (offset + 4 <= view.byteLength) {
        if (view.getUint8(offset) !== 0xff) break;
        var marker = view.getUint8(offset + 1);
        if (marker === 0xda || marker === 0xd9) break;
        var length = view.getUint16(offset + 2, false);
        if (length < 2 || offset + 2 + length > view.byteLength) break;
        if (marker === 0xe1 && readAscii(view, offset + 4, 6) === 'Exif') {
            var tiffOffset = offset + 10;
            if (tiffOffset + 8 > view.byteLength) return 0;
            var byteOrder = view.getUint16(tiffOffset, false);
            var littleEndian = byteOrder === 0x4949;
            if (!littleEndian && byteOrder !== 0x4d4d) return 0;
            if (view.getUint16(tiffOffset + 2, littleEndian) !== 42) return 0;
            var firstIfd = view.getUint32(tiffOffset + 4, littleEndian);
            var primary = readIfd(view, tiffOffset, firstIfd, littleEndian);
            if (primary.exifOffset) {
                var exif = readIfd(view, tiffOffset, primary.exifOffset, littleEndian);
                if (exif.date) return new Date(exif.date).toISOString();
            }
            return primary.date ? new Date(primary.date).toISOString() : null;
        }
        offset += 2 + length;
    }
    return null;
}

export async function readCaptureTime(file) {
    var fallback = Math.max(0, Number(file && file.lastModified) || 0);
    var fallbackValue = fallback ? new Date(fallback).toISOString() : null;
    if (!file || !/jpe?g/i.test(String(file.type || file.name || '')) || typeof file.slice !== 'function') return fallbackValue;
    try {
        var header = await file.slice(0, Math.min(file.size || 0, 512 * 1024)).arrayBuffer();
        return parseExifCaptureTime(header) || fallbackValue;
    } catch (ignore) {
        return fallbackValue;
    }
}
