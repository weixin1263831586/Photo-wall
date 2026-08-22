function clamp(value, min, max, fallback) {
    value = Number(value);
    if (!Number.isFinite(value)) value = fallback;
    return Math.max(min, Math.min(max, value));
}

/** A slot can be panned by up to one full slot in either direction. */
export const SLOT_LOCAL_OFFSET_LIMIT = 2;

/** Slot-local zoom keeps the crop filled while allowing a focused close-up. */
export const SLOT_LOCAL_ZOOM_MIN = 1;
export const SLOT_LOCAL_ZOOM_MAX = 4;

/** Adds a rounded rectangle to the current path, including pre-Chrome 99 WebViews. */
export function addRoundedRectPath(context, x, y, width, height, radius) {
    if (!context) return;
    radius = Math.max(0, Math.min(Math.abs(width) / 2, Math.abs(height) / 2, Number(radius) || 0));
    if (typeof context.roundRect === 'function') {
        context.roundRect(x, y, width, height, radius);
        return;
    }
    var left = Math.min(x, x + width);
    var right = Math.max(x, x + width);
    var top = Math.min(y, y + height);
    var bottom = Math.max(y, y + height);
    context.moveTo(left + radius, top);
    context.lineTo(right - radius, top);
    context.quadraticCurveTo(right, top, right, top + radius);
    context.lineTo(right, bottom - radius);
    context.quadraticCurveTo(right, bottom, right - radius, bottom);
    context.lineTo(left + radius, bottom);
    context.quadraticCurveTo(left, bottom, left, bottom - radius);
    context.lineTo(left, top + radius);
    context.quadraticCurveTo(left, top, left + radius, top);
    context.closePath();
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
    /* Live <video> elements report their intrinsic size through videoWidth /
       videoHeight; naturalWidth/width would fall back to the element box. */
    return {
        width: Math.max(1, Number(image && (image.videoWidth || image.naturalWidth || image.width)) || 1),
        height: Math.max(1, Number(image && (image.videoHeight || image.naturalHeight || image.height)) || 1)
    };
}

/** Calculates a cover crop that places the detected subject at a requested target point. */
export function photoCoverLayout(image, width, height, photo, placement) {
    var transform = normalizePhotoTransform(photo);
    var dimensions = photoImageDimensions(image);
    var radians = transform.rotation * Math.PI / 180;
    var cosine = Math.abs(Math.cos(radians));
    var sine = Math.abs(Math.sin(radians));
    var requiredWidth = width * cosine + height * sine;
    var requiredHeight = width * sine + height * cosine;
    /* Boundary auto-cropping contributes up to 1.5x and the user can then add
       up to 4x slot-local zoom, so retain the full combined range here. */
    var placementZoom = clamp(placement && placement.zoom,
        SLOT_LOCAL_ZOOM_MIN, SLOT_LOCAL_ZOOM_MAX * 1.5, 1);
    var scale = Math.max(requiredWidth / dimensions.width, requiredHeight / dimensions.height) * transform.zoom * placementZoom;
    var drawWidth = dimensions.width * scale;
    var drawHeight = dimensions.height * scale;
    placement = placement || {};
    var targetX = clamp(placement.targetX, 0, 1, 0.5);
    var targetY = clamp(placement.targetY, 0, 1, 0.5);
    var localOffsetX = clamp(placement.offsetX, -SLOT_LOCAL_OFFSET_LIMIT, SLOT_LOCAL_OFFSET_LIMIT, 0);
    var localOffsetY = clamp(placement.offsetY, -SLOT_LOCAL_OFFSET_LIMIT, SLOT_LOCAL_OFFSET_LIMIT, 0);
    var desiredX = (targetX - 0.5) * requiredWidth - transform.focusX * drawWidth;
    var desiredY = (targetY - 0.5) * requiredHeight - transform.focusY * drawHeight;
    var safeBounds = placement.safeBounds && typeof placement.safeBounds === 'object' ? placement.safeBounds : null;
    var safeX = safeBounds ? clamp(safeBounds.x, 0, 0.99, 0) : 0;
    var safeY = safeBounds ? clamp(safeBounds.y, 0, 0.99, 0) : 0;
    var safeWidth = safeBounds ? clamp(safeBounds.width, 0.01, 1 - safeX, 1 - safeX) : 1;
    var safeHeight = safeBounds ? clamp(safeBounds.height, 0.01, 1 - safeY, 1 - safeY) : 1;
    var minDrawX = (safeX + safeWidth - 0.5) * requiredWidth - drawWidth;
    var maxDrawX = (safeX - 0.5) * requiredWidth;
    var minDrawY = (safeY + safeHeight - 0.5) * requiredHeight - drawHeight;
    var maxDrawY = (safeY - 0.5) * requiredHeight;

    /* localOffset is a normalised pan control: ±SLOT_LOCAL_OFFSET_LIMIT
       reaches the corresponding edge of every available source crop. This
       keeps the whole image reachable after a large local zoom instead of
       limiting movement to one fixed slot width. */
    var baseDrawX = clamp(desiredX, minDrawX, maxDrawX, 0);
    var baseDrawY = clamp(desiredY, minDrawY, maxDrawY, 0);
    var panX = localOffsetX / SLOT_LOCAL_OFFSET_LIMIT;
    var panY = localOffsetY / SLOT_LOCAL_OFFSET_LIMIT;
    var drawX = panX >= 0 ? baseDrawX + (maxDrawX - baseDrawX) * panX :
        baseDrawX + (baseDrawX - minDrawX) * panX;
    var drawY = panY >= 0 ? baseDrawY + (maxDrawY - baseDrawY) * panY :
        baseDrawY + (baseDrawY - minDrawY) * panY;
    return {
        transform: transform,
        radians: radians,
        requiredWidth: requiredWidth,
        requiredHeight: requiredHeight,
        drawWidth: drawWidth,
        drawHeight: drawHeight,
        drawX: drawX,
        drawY: drawY
    };
}

/** Draw a transformed image so the rotated source still covers the target box. */
export function drawPhotoCover(context, image, width, height, photo, placement) {
    if (!context || !image || width <= 0 || height <= 0) return;
    var layout = photoCoverLayout(image, width, height, photo, placement);
    var transform = layout.transform;

    context.save();
    context.translate(transform.offsetX * width * 0.5, transform.offsetY * height * 0.5);
    context.rotate(layout.radians);
    context.scale(transform.flipX ? -1 : 1, transform.flipY ? -1 : 1);
    context.drawImage(
        image,
        layout.drawX,
        layout.drawY,
        layout.drawWidth,
        layout.drawHeight
    );
    context.restore();
}
