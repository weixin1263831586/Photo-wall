function clamp(value, min, max, fallback) {
    value = Number(value);
    return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

export function normalizeOverlay(overlay, index) {
    overlay = overlay || {};
    var type = ['text', 'sticker', 'border'].includes(overlay.type) ? overlay.type : 'text';
    return {
        id: String(overlay.id || 'overlay-' + (index || 0)),
        type: type,
        role: String(overlay.role || type),
        content: String(overlay.content == null ? (type === 'sticker' ? '★' : '标题') : overlay.content).slice(0, 120),
        x: clamp(overlay.x, 0, 1, 0.5),
        y: clamp(overlay.y, 0, 1, 0.18),
        fontSize: clamp(overlay.fontSize, 0.018, 0.22, type === 'sticker' ? 0.085 : 0.055),
        rotation: clamp(overlay.rotation, -180, 180, 0),
        color: /^#[0-9a-f]{6}$/i.test(overlay.color) ? overlay.color : '#ffffff',
        fontFamily: String(overlay.fontFamily || 'system-ui, sans-serif'),
        fontWeight: overlay.fontWeight === 'normal' ? 'normal' : '700',
        align: ['left', 'center', 'right'].includes(overlay.align) ? overlay.align : 'center',
        shadow: overlay.shadow !== false,
        visible: overlay.visible !== false,
        zIndex: clamp(overlay.zIndex, -1000, 1000, index || 0),
        borderStyle: ['classic', 'double', 'film'].includes(overlay.borderStyle) ? overlay.borderStyle : 'classic',
        borderWidth: clamp(overlay.borderWidth, 0.002, 0.06, 0.012)
    };
}

export function normalizeOverlays(overlays) {
    return (Array.isArray(overlays) ? overlays : []).map(normalizeOverlay);
}

function overlayMetrics(context, overlay, width, height, bounds) {
    var unit = Math.min(width, height);
    if (overlay.type === 'border') {
        var frame = bounds || { x: 0, y: 0, width: width, height: height };
        return { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
    }
    var size = overlay.fontSize * unit;
    context.save();
    context.font = overlay.fontWeight + ' ' + size + 'px ' + overlay.fontFamily;
    var textWidth = Math.max(size, context.measureText(overlay.content).width);
    context.restore();
    /* drawOverlay renders at the anchor point with textAlign honoured, then
       rotates around that anchor. Mirror both so the hit box covers what is
       actually painted. */
    var alignOffset = overlay.align === 'left' ? textWidth / 2 :
        overlay.align === 'right' ? -textWidth / 2 : 0;
    var boxWidth = textWidth + size * 0.4;
    var boxHeight = size * 1.4;
    var cx = overlay.x * width + alignOffset;
    var cy = overlay.y * height;
    var rad = overlay.rotation * Math.PI / 180;
    var cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
    return {
        x: cx - (boxWidth * cos + boxHeight * sin) / 2,
        y: cy - (boxWidth * sin + boxHeight * cos) / 2,
        width: boxWidth * cos + boxHeight * sin,
        height: boxWidth * sin + boxHeight * cos
    };
}

function drawBorder(context, overlay, width, height, bounds) {
    var frame = bounds || { x: 0, y: 0, width: width, height: height };
    var unit = Math.min(width, height);
    var lineWidth = overlay.borderWidth * unit;
    var inset = lineWidth * 1.2;
    context.save();
    context.strokeStyle = overlay.color;
    context.lineWidth = lineWidth;
    if (overlay.borderStyle === 'film') {
        context.setLineDash([lineWidth * 1.4, lineWidth * 0.8]);
        context.lineCap = 'square';
    }
    context.strokeRect(frame.x + inset, frame.y + inset,
        Math.max(1, frame.width - inset * 2), Math.max(1, frame.height - inset * 2));
    if (overlay.borderStyle === 'double') {
        var secondInset = inset + lineWidth * 1.8;
        context.lineWidth = Math.max(1, lineWidth * 0.38);
        context.strokeRect(frame.x + secondInset, frame.y + secondInset,
            Math.max(1, frame.width - secondInset * 2), Math.max(1, frame.height - secondInset * 2));
    }
    context.restore();
}

export function drawOverlay(context, rawOverlay, width, height, options) {
    var overlay = normalizeOverlay(rawOverlay);
    if (!overlay.visible) return;
    options = options || {};
    if (overlay.type === 'border') {
        drawBorder(context, overlay, width, height, options.bounds);
        return;
    }
    var size = overlay.fontSize * Math.min(width, height);
    context.save();
    context.translate(overlay.x * width, overlay.y * height);
    context.rotate(overlay.rotation * Math.PI / 180);
    context.font = overlay.fontWeight + ' ' + size + 'px ' + overlay.fontFamily;
    context.textAlign = overlay.align;
    context.textBaseline = 'middle';
    context.fillStyle = overlay.color;
    if (overlay.shadow) {
        context.shadowColor = 'rgba(0,0,0,.72)';
        context.shadowBlur = Math.max(2, size * 0.12);
        context.shadowOffsetY = Math.max(1, size * 0.04);
    }
    context.fillText(overlay.content, 0, 0);
    context.restore();
}

export function drawOverlays(context, overlays, width, height, options) {
    normalizeOverlays(overlays).sort(function (a, b) { return a.zIndex - b.zIndex; })
        .forEach(function (overlay) { drawOverlay(context, overlay, width, height, options); });
}

export function getOverlayAt(context, overlays, x, y, width, height, bounds) {
    var ordered = normalizeOverlays(overlays).filter(function (overlay) {
        return overlay.visible && overlay.type !== 'border';
    }).sort(function (a, b) { return b.zIndex - a.zIndex; });
    for (var index = 0; index < ordered.length; index++) {
        var metrics = overlayMetrics(context, ordered[index], width, height, bounds);
        if (x >= metrics.x && x <= metrics.x + metrics.width && y >= metrics.y && y <= metrics.y + metrics.height) {
            return ordered[index].id;
        }
    }
    return null;
}

export function createOverlay(type, id, content, overrides) {
    return normalizeOverlay(Object.assign({ id: id, type: type, content: content }, overrides || {}));
}
