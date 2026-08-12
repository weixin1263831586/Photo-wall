const PRESETS = [
    {
        id: 'classic',
        name: '经典相框',
        category: '通用',
        palette: ['#403b68', '#9d8cff'],
        icon: '▦',
        description: '规整耐看',
        shapeKey: 'roundedSquare',
        settings: {
            density: 1,
            gap: 0.01,
            placementMode: 'grid',
            photoShape: 'square',
            smartPlacement: true,
            mixedSizes: true,
            rotationRange: 0
        }
    },
    {
        id: 'wedding',
        name: '婚礼纪念',
        category: '婚礼',
        palette: ['#71304f', '#f6a6c8'],
        icon: '♥',
        description: '柔和双心',
        shapeKey: 'doubleHeart',
        settings: {
            density: 0.9,
            gap: 0.03,
            placementMode: 'organic',
            photoShape: 'circle',
            smartPlacement: true,
            mixedSizes: true,
            rotationRange: 3
        }
    },
    {
        id: 'travel',
        name: '旅行足迹',
        category: '旅行',
        palette: ['#19566b', '#68d7ce'],
        icon: '✈',
        description: '轻松错落',
        shapeKey: 'airplane',
        settings: {
            density: 1.05,
            gap: 0.02,
            placementMode: 'organic',
            photoShape: 'square',
            smartPlacement: true,
            mixedSizes: true,
            rotationRange: 8
        }
    },
    {
        id: 'growth',
        name: '成长记录',
        category: '生日',
        palette: ['#744526', '#ffc76e'],
        icon: '●',
        description: '活泼气球',
        shapeKey: 'balloon',
        settings: {
            density: 0.95,
            gap: 0.03,
            placementMode: 'brick',
            photoShape: 'circle',
            smartPlacement: true,
            mixedSizes: true,
            rotationRange: 4
        }
    },
    {
        id: 'graduation',
        name: '毕业留念',
        category: '毕业',
        palette: ['#27395f', '#8eadff'],
        icon: '◆',
        description: '整洁庄重',
        shapeKey: 'graduation',
        settings: {
            density: 1,
            gap: 0.015,
            placementMode: 'brick',
            photoShape: 'square',
            smartPlacement: true,
            mixedSizes: true,
            rotationRange: 2
        }
    },
    {
        id: 'pet',
        name: '萌宠日常',
        category: '生活',
        palette: ['#3f5940', '#a5d88b'],
        icon: '●',
        description: '自然脚印',
        shapeKey: 'paw',
        settings: {
            density: 1,
            gap: 0.025,
            placementMode: 'organic',
            photoShape: 'circle',
            smartPlacement: true,
            mixedSizes: true,
            rotationRange: 6
        }
    }
];

export const LAYOUT_PRESETS = Object.freeze(PRESETS.map(function (preset) {
    return Object.freeze(Object.assign({}, preset, { settings: Object.freeze(Object.assign({}, preset.settings)) }));
}));

export function getLayoutPreset(id) {
    return LAYOUT_PRESETS.find(function (preset) { return preset.id === id; }) || null;
}

export function layoutPresetMatches(wall, shapeKey, preset) {
    if (!wall || !preset) return false;
    if (preset.shapeKey && preset.shapeKey !== shapeKey) return false;
    var settings = preset.settings;
    return Math.abs(wall.density - settings.density) < 0.0001 &&
        Math.abs(wall.gap - settings.gap) < 0.0001 &&
        wall.placementMode === settings.placementMode &&
        wall.photoShape === settings.photoShape &&
        wall.smartPlacement === settings.smartPlacement &&
        wall.mixedSizes === settings.mixedSizes &&
        Math.abs(wall.rotationRange - settings.rotationRange) < 0.0001;
}

/** Apply all settings in one pass so a preset triggers only one new layout. */
export function applyLayoutPreset(wall, preset, shape) {
    if (!wall || !preset) throw new Error('A wall and layout preset are required');
    if (preset.shapeKey && !shape) throw new Error('Preset shape is unavailable: ' + preset.shapeKey);
    var settings = preset.settings;
    wall.density = settings.density;
    wall.gap = settings.gap;
    wall.placementMode = settings.placementMode;
    wall.photoShape = settings.photoShape;
    wall.smartPlacement = settings.smartPlacement;
    wall.mixedSizes = settings.mixedSizes;
    wall.rotationRange = settings.rotationRange;
    if (preset.shapeKey) {
        wall.shapeKey = preset.shapeKey;
        wall.shape = shape;
    }
    if (wall.shape) wall.generateLayout();
    return preset;
}
