function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
}

export function dominantFaceFocus(faces, width, height) {
    if (!Array.isArray(faces) || !faces.length || !width || !height) return null;
    var normalizedFaces = faces.map(function (face) {
        var box = face && face.boundingBox;
        var area = box ? Math.max(0, Number(box.width) || 0) * Math.max(0, Number(box.height) || 0) : 0;
        if (!box || !area) return null;
        return {
            box: box,
            area: area,
            normalized: {
                x: clamp01(Number(box.x) / width),
                y: clamp01(Number(box.y) / height),
                width: clamp01(Number(box.width) / width),
                height: clamp01(Number(box.height) / height)
            }
        };
    }).filter(Boolean);
    var dominant = normalizedFaces.reduce(function (best, face) {
        return !best || face.area > best.area ? face : best;
    }, null);
    if (!dominant || !dominant.box || !dominant.area) return null;
    /* Normalised face box [0,1] for downstream auto-crop optimisation. */
    var faceBox = dominant.normalized;
    var minX = Math.min.apply(null, normalizedFaces.map(function (face) { return face.normalized.x; }));
    var minY = Math.min.apply(null, normalizedFaces.map(function (face) { return face.normalized.y; }));
    var maxX = Math.max.apply(null, normalizedFaces.map(function (face) { return face.normalized.x + face.normalized.width; }));
    var maxY = Math.max.apply(null, normalizedFaces.map(function (face) { return face.normalized.y + face.normalized.height; }));
    var faceGroupBox = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    /* Medium/large tiles frame the whole group instead of only the largest face. */
    var expandX = faceGroupBox.width * 0.18;
    var personX = clamp01(faceGroupBox.x - expandX);
    var personBox = {
        x: personX,
        y: faceGroupBox.y,
        width: Math.min(1 - personX, faceGroupBox.width + expandX * 2),
        height: Math.min(1 - faceGroupBox.y, faceGroupBox.height * 2.8)
    };
    var totalFaceArea = normalizedFaces.reduce(function (sum, face) { return sum + face.area; }, 0);
    return {
        focusX: clamp01((Number(dominant.box.x) + Number(dominant.box.width) / 2) / width),
        focusY: clamp01((Number(dominant.box.y) + Number(dominant.box.height) / 2) / height),
        subjectScore: clamp01(totalFaceArea / (width * height)),
        subjectConfidence: clamp01(0.68 + Math.sqrt(totalFaceArea / (width * height)) * 0.9),
        focusSource: 'face',
        faceBox: faceBox,
        faceBoxes: normalizedFaces.map(function (face) { return face.normalized; }),
        faceGroupBox: faceGroupBox,
        faceCount: normalizedFaces.length,
        personBox: personBox
    };
}

/** Uses the browser's local face detector when present and keeps saliency as a safe fallback. */
export async function refineSubjectFocus(source, analysis, FaceDetectorCtor) {
    var result = Object.assign({ focusSource: 'saliency', subjectScore: 0, subjectConfidence: 0, faceBox: null, faceBoxes: [], faceGroupBox: null, faceCount: 0, personBox: null }, analysis || {});
    var Detector = FaceDetectorCtor || (typeof globalThis !== 'undefined' ? globalThis.FaceDetector : null);
    if (typeof Detector !== 'function' || !source) return result;
    try {
        var detector = new Detector({ fastMode: true, maxDetectedFaces: 8 });
        var faces = await detector.detect(source);
        var width = Number(source.naturalWidth || source.videoWidth || source.width) || 1;
        var height = Number(source.naturalHeight || source.videoHeight || source.height) || 1;
        return Object.assign(result, dominantFaceFocus(faces, width, height) || {});
    } catch (ignore) {
        return result;
    }
}
