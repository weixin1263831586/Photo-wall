const STORAGE_KEY = 'photo-wall-custom-templates-v1';
const MAX_CUSTOM_TEMPLATES = 30;

function normalizeTemplate(template, index) {
    if (!template || typeof template !== 'object') return null;
    var settings = template.settings || {};
    var id = String(template.id || 'custom-' + index).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
    var name = String(template.name || '自定义模板').trim().slice(0, 30);
    if (!id || !name) return null;
    return {
        id: id,
        name: name,
        category: '自定义',
        icon: String(template.icon || '★').slice(0, 2),
        description: String(template.description || '我的版式').slice(0, 40),
        shapeKey: String(template.shapeKey || 'china'),
        thumbnail: typeof template.thumbnail === 'string' && template.thumbnail.startsWith('data:image/') ?
            template.thumbnail : '',
        custom: true,
        settings: {
            density: Math.max(0.5, Math.min(1.5, Number(settings.density) || 1)),
            gap: Math.max(0, Math.min(0.12, Number(settings.gap) || 0)),
            placementMode: ['grid', 'brick', 'organic'].includes(settings.placementMode) ? settings.placementMode : 'grid',
            photoShape: ['circle', 'square', 'diamond', 'hexagon', 'heart'].includes(settings.photoShape) ? settings.photoShape : 'square',
            smartPlacement: settings.smartPlacement !== false,
            mixedSizes: settings.mixedSizes !== false,
            rotationRange: Math.max(0, Math.min(24, Number(settings.rotationRange) || 0)),
            matrixColumns: [2, 3, 4, 5, 6, 8].includes(Number(settings.matrixColumns)) ? Number(settings.matrixColumns) : 0
        }
    };
}

export function createTemplateLibrary(options) {
    options = options || {};
    var storage = options.storage === undefined ? globalThis.localStorage : options.storage;
    var custom = [];

    function persist() {
        if (!storage) return;
        storage.setItem(STORAGE_KEY, JSON.stringify(custom));
    }

    function load() {
        if (!storage) return [];
        try {
            var value = JSON.parse(storage.getItem(STORAGE_KEY) || '[]');
            custom = Array.isArray(value) ? value.map(normalizeTemplate).filter(Boolean).slice(0, MAX_CUSTOM_TEMPLATES) : [];
        } catch (error) {
            custom = [];
        }
        return custom.slice();
    }

    function save(template) {
        var normalized = normalizeTemplate(template, Date.now());
        if (!normalized) throw new Error('Invalid custom template');
        custom = [normalized].concat(custom.filter(function (item) { return item.id !== normalized.id; }))
            .slice(0, MAX_CUSTOM_TEMPLATES);
        persist();
        return normalized;
    }

    function remove(id) {
        var before = custom.length;
        custom = custom.filter(function (item) { return item.id !== id; });
        if (custom.length !== before) persist();
        return custom.length !== before;
    }

    function list() {
        return custom.slice();
    }

    load();
    return { load: load, save: save, remove: remove, list: list };
}

export { MAX_CUSTOM_TEMPLATES, STORAGE_KEY };
