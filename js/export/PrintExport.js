const MM_PER_INCH = 25.4;
const POINTS_PER_INCH = 72;

export const PRINT_PRESETS = Object.freeze([
    { id: 'a4-portrait', name: 'A4 竖版', widthMm: 210, heightMm: 297 },
    { id: 'a4-landscape', name: 'A4 横版', widthMm: 297, heightMm: 210 },
    { id: 'a3-portrait', name: 'A3 竖版', widthMm: 297, heightMm: 420 },
    { id: 'a3-landscape', name: 'A3 横版', widthMm: 420, heightMm: 297 },
    { id: 'poster-12x18', name: '海报 12×18 英寸', widthMm: 304.8, heightMm: 457.2 }
]);

export function getPrintPreset(id) {
    return PRINT_PRESETS.find(function (preset) { return preset.id === id; }) || PRINT_PRESETS[0];
}

export function millimetresToPixels(mm, dpi) {
    return Math.max(1, Math.round(mm / MM_PER_INCH * dpi));
}

export function printPixelDimensions(preset, dpi, bleedMm) {
    preset = preset || PRINT_PRESETS[0];
    dpi = Math.max(72, Math.min(600, Number(dpi) || 300));
    bleedMm = Math.max(0, Math.min(10, Number(bleedMm) || 0));
    return {
        width: millimetresToPixels(preset.widthMm + bleedMm * 2, dpi),
        height: millimetresToPixels(preset.heightMm + bleedMm * 2, dpi),
        dpi: dpi,
        bleedMm: bleedMm
    };
}

export function assessPrintResolution(widthPixels, heightPixels, preset) {
    preset = preset || PRINT_PRESETS[0];
    var horizontalDpi = widthPixels / (preset.widthMm / MM_PER_INCH);
    var verticalDpi = heightPixels / (preset.heightMm / MM_PER_INCH);
    // Standard paper dimensions round to whole pixels (A4/300 DPI is
    // 2480×3508), so round the measured value instead of downgrading 299.99.
    var dpi = Math.round(Math.min(horizontalDpi, verticalDpi));
    return {
        dpi: dpi,
        quality: dpi >= 300 ? 'excellent' : dpi >= 200 ? 'good' : dpi >= 150 ? 'fair' : 'low',
        label: dpi >= 300 ? '专业印刷' : dpi >= 200 ? '高质量打印' : dpi >= 150 ? '普通打印' : '清晰度不足'
    };
}

function mmToPoints(mm) {
    return mm / MM_PER_INCH * POINTS_PER_INCH;
}

function canvasBlob(canvas) {
    return new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) {
            if (blob) resolve(blob);
            else reject(new Error('Print image encode failed'));
        }, 'image/png');
    });
}

export async function createPrintPdf(canvas, options) {
    var pdfLib = await import('pdf-lib');
    var PDFDocument = pdfLib.PDFDocument;
    var rgb = pdfLib.rgb;
    options = options || {};
    var preset = options.preset || PRINT_PRESETS[0];
    var bleedMm = Math.max(0, Math.min(10, Number(options.bleedMm) || 0));
    var totalWidthMm = preset.widthMm + bleedMm * 2;
    var totalHeightMm = preset.heightMm + bleedMm * 2;
    var pageWidth = mmToPoints(totalWidthMm);
    var pageHeight = mmToPoints(totalHeightMm);
    var pdfDoc = await PDFDocument.create();
    pdfDoc.setTitle(options.title || 'Photo Wall');
    pdfDoc.setCreator('Photo Wall');
    pdfDoc.setProducer('Photo Wall local print export');
    var page = pdfDoc.addPage([pageWidth, pageHeight]);
    var png = await pdfDoc.embedPng(await (await canvasBlob(canvas)).arrayBuffer());
    page.drawImage(png, { x: 0, y: 0, width: pageWidth, height: pageHeight });

    if (bleedMm > 0 && options.cropMarks !== false) {
        var inset = mmToPoints(bleedMm);
        var mark = Math.min(inset * 0.72, mmToPoints(4));
        var lineOptions = { thickness: 0.35, color: rgb(0.12, 0.12, 0.12), opacity: 0.8 };
        var left = inset, right = pageWidth - inset, bottom = inset, top = pageHeight - inset;
        [
            [left - mark, bottom, left, bottom], [left, bottom - mark, left, bottom],
            [right, bottom, right + mark, bottom], [right, bottom - mark, right, bottom],
            [left - mark, top, left, top], [left, top, left, top + mark],
            [right, top, right + mark, top], [right, top, right, top + mark]
        ].forEach(function (line) {
            page.drawLine(Object.assign({
                start: { x: line[0], y: line[1] },
                end: { x: line[2], y: line[3] }
            }, lineOptions));
        });
    }
    return new Blob([await pdfDoc.save()], { type: 'application/pdf' });
}
