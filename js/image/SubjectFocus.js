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
    return {
        focusX: clamp01((Number(dominant.box.x) + Number(dominant.box.width) / 2) / width),
        focusY: clamp01((Number(dominant.box.y) + Number(dominant.box.height) / 2) / height),
        subjectScore: clamp01(dominant.area / (width * height)),
        focusSource: 'face'
    };
}

/** Uses the browser's local face detector when present and keeps saliency as a safe fallback. */
export async function refineSubjectFocus(source, analysis, FaceDetectorCtor) {
    var result = Object.assign({ focusSource: 'saliency', subjectScore: 0 }, analysis || {});
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
