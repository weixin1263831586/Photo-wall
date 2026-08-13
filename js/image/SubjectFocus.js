function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
}

export function dominantFaceFocus(faces, width, height) {
    if (!Array.isArray(faces) || !faces.length || !width || !height) return null;
    var dominant = faces.reduce(function (best, face) {
        var box = face && face.boundingBox;
        var area = box ? Math.max(0, Number(box.width) || 0) * Math.max(0, Number(box.height) || 0) : 0;
        return !best || area > best.area ? { box: box, area: area } : best;
    }, null);
    if (!dominant || !dominant.box || !dominant.area) return null;
    /* Normalised face box [0,1] for downstream auto-crop optimisation. */
    var faceBox = {
        x: clamp01(Number(dominant.box.x) / width),
        y: clamp01(Number(dominant.box.y) / height),
        width: clamp01(Number(dominant.box.width) / width),
        height: clamp01(Number(dominant.box.height) / height)
    };
    /* Approximate upper-body box: widen slightly, extend downward. */
    var expandX = faceBox.width * 0.3;
    var personX = clamp01(faceBox.x - expandX);
    var personBox = {
        x: personX,
        y: faceBox.y,
        width: Math.min(1 - personX, faceBox.width + expandX * 2),
        height: Math.min(1 - faceBox.y, faceBox.height * 2.8)
    };
    return {
        focusX: clamp01((Number(dominant.box.x) + Number(dominant.box.width) / 2) / width),
        focusY: clamp01((Number(dominant.box.y) + Number(dominant.box.height) / 2) / height),
        subjectScore: clamp01(dominant.area / (width * height)),
        focusSource: 'face',
        faceBox: faceBox,
        personBox: personBox
    };
}

/** Uses the browser's local face detector when present and keeps saliency as a safe fallback. */
export async function refineSubjectFocus(source, analysis, FaceDetectorCtor) {
    var result = Object.assign({ focusSource: 'saliency', subjectScore: 0, faceBox: null, personBox: null }, analysis || {});
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
