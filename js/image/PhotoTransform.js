function clamp(value, min, max, fallback) {
    value = Number(value);
    if (!Number.isFinite(value)) value = fallback;
    return Math.max(min, Math.min(max, value));
}

export function normalizePhotoTransform(photo) {
    photo = photo || {};
    return {
        focusX: clamp(photo.focusX, 0, 1, 0.5),
        focusY: clamp(photo.focusY, 0, 1, 0.5),
        zoom: clamp(photo.editZoom, 1, 4, 1),
        offsetX: clamp(photo.editOffsetX, -1, 1, 0),
        offsetY: clamp(photo.editOffsetY, -1, 1, 0),
        rotation: clamp(photo.editRotation, -180, 180, 0),
        flipX: photo.flipX === true,
        flipY: photo.flipY === true
    };
}

export function applyPhotoTransform(photo, transform) {
    transform = normalizePhotoTransform(Object.assign({}, photo, {
        focusX: transform.focusX,
        focusY: transform.focusY,
        editZoom: transform.zoom,
        editOffsetX: transform.offsetX,
        editOffsetY: transform.offsetY,
        editRotation: transform.rotation,
        flipX: transform.flipX,
        flipY: transform.flipY
    }));
    photo.focusX = transform.focusX;
    photo.focusY = transform.focusY;
    photo.editZoom = transform.zoom;
    photo.editOffsetX = transform.offsetX;
    photo.editOffsetY = transform.offsetY;
    photo.editRotation = transform.rotation;
    photo.flipX = transform.flipX;
    photo.flipY = transform.flipY;
    return photo;
}

export function photoImageDimensions(image) {
    return {
        width: Math.max(1, Number(image && (image.naturalWidth || image.width)) || 1),
        height: Math.max(1, Number(image && (image.naturalHeight || image.height)) || 1)
    };
}

/** Draw a transformed image so the rotated source still covers the target box. */
export function drawPhotoCover(context, image, width, height, photo) {
    if (!context || !image || width <= 0 || height <= 0) return;
    var transform = normalizePhotoTransform(photo);
    var dimensions = photoImageDimensions(image);
    var radians = transform.rotation * Math.PI / 180;
    var cosine = Math.abs(Math.cos(radians));
    var sine = Math.abs(Math.sin(radians));
    var requiredWidth = width * cosine + height * sine;
    var requiredHeight = width * sine + height * cosine;
    var scale = Math.max(requiredWidth / dimensions.width, requiredHeight / dimensions.height) * transform.zoom;
    var drawWidth = dimensions.width * scale;
    var drawHeight = dimensions.height * scale;
    var focusOffsetX = (0.5 - transform.focusX) * Math.max(0, drawWidth - requiredWidth);
    var focusOffsetY = (0.5 - transform.focusY) * Math.max(0, drawHeight - requiredHeight);

    context.save();
    context.translate(transform.offsetX * width * 0.5, transform.offsetY * height * 0.5);
    context.rotate(radians);
    context.scale(transform.flipX ? -1 : 1, transform.flipY ? -1 : 1);
    context.drawImage(
        image,
        -drawWidth / 2 + focusOffsetX,
        -drawHeight / 2 + focusOffsetY,
        drawWidth,
        drawHeight
    );
    context.restore();
}
