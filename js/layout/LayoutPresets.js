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
    },
    {
        id: 'matrix-2', name: '四宫格', category: '矩阵', palette: ['#33415c', '#8da9c4'], icon: '2×2', description: '四张均分', shapeKey: 'roundedSquare',
        settings: { density: 1, gap: 0.025, placementMode: 'grid', photoShape: 'square', smartPlacement: true, mixedSizes: false, rotationRange: 0, matrixColumns: 2 }
    },
    {
        id: 'matrix-3', name: '九宫格', category: '矩阵', palette: ['#5b3f72', '#d1a7e8'], icon: '3×3', description: '社交平台经典', shapeKey: 'roundedSquare',
        settings: { density: 1, gap: 0.02, placementMode: 'grid', photoShape: 'square', smartPlacement: true, mixedSizes: false, rotationRange: 0, matrixColumns: 3 }
    },
    {
        id: 'matrix-4', name: '十六格', category: '矩阵', palette: ['#305f72', '#68b0ab'], icon: '4×4', description: '紧凑故事集', shapeKey: 'roundedSquare',
        settings: { density: 1, gap: 0.015, placementMode: 'grid', photoShape: 'square', smartPlacement: true, mixedSizes: false, rotationRange: 0, matrixColumns: 4 }
    },
    {
        id: 'matrix-5', name: '二十五格', category: '矩阵', palette: ['#3d5a45', '#9bc59d'], icon: '5×5', description: '密集回忆墙', shapeKey: 'roundedSquare',
        settings: { density: 1, gap: 0.012, placementMode: 'grid', photoShape: 'square', smartPlacement: true, mixedSizes: false, rotationRange: 0, matrixColumns: 5 }
    },
    {
        id: 'matrix-6', name: '三十六格', category: '矩阵', palette: ['#60463b', '#d5aa8b'], icon: '6×6', description: '大容量矩阵', shapeKey: 'roundedSquare',
        settings: { density: 1, gap: 0.01, placementMode: 'grid', photoShape: 'square', smartPlacement: true, mixedSizes: false, rotationRange: 0, matrixColumns: 6 }
    },
    {
        id: 'social-circle', name: '社交头像墙', category: '社交', palette: ['#2f4858', '#57cc99'], icon: '●', description: '圆形头像阵列', shapeKey: 'roundedSquare',
        settings: { density: 1, gap: 0.055, placementMode: 'grid', photoShape: 'circle', smartPlacement: true, mixedSizes: false, rotationRange: 0, matrixColumns: 4 }
    },
    {
        id: 'film-camera', name: '胶片相机', category: '生活', palette: ['#292929', '#d8c3a5'], icon: '▣', description: '摄影日常', shapeKey: 'camera',
        settings: { density: 1.08, gap: 0.018, placementMode: 'brick', photoShape: 'square', smartPlacement: true, mixedSizes: true, rotationRange: 2, matrixColumns: 0 }
    },
    {
        id: 'family-tree', name: '家族时光树', category: '生活', palette: ['#36523b', '#d6b36a'], icon: '♣', description: '多代家庭回忆', shapeKey: 'tree',
        settings: { density: 1.05, gap: 0.025, placementMode: 'organic', photoShape: 'circle', smartPlacement: true, mixedSizes: true, rotationRange: 3, matrixColumns: 0 }
    },
    {
        id: 'birthday-cake', name: '生日蛋糕', category: '生日', palette: ['#7a4057', '#ffd166'], icon: '🎂', description: '聚会打卡海报', shapeKey: 'cake',
        settings: { density: 1, gap: 0.025, placementMode: 'organic', photoShape: 'circle', smartPlacement: true, mixedSizes: true, rotationRange: 5, matrixColumns: 0 }
    },
    {
        id: 'gift-memory', name: '礼物盒', category: '节日', palette: ['#7b2d3d', '#f6bd60'], icon: '🎁', description: '节日祝福合集', shapeKey: 'gift',
        settings: { density: 1, gap: 0.02, placementMode: 'brick', photoShape: 'square', smartPlacement: true, mixedSizes: true, rotationRange: 2, matrixColumns: 0 }
    },
    {
        id: 'star-moments', name: '闪耀时刻', category: '节日', palette: ['#453781', '#f7d154'], icon: '★', description: '舞台与庆典', shapeKey: 'star',
        settings: { density: 1.08, gap: 0.02, placementMode: 'organic', photoShape: 'diamond', smartPlacement: true, mixedSizes: true, rotationRange: 4, matrixColumns: 0 }
    },
    {
        id: 'music-album', name: '音乐相册', category: '社交', palette: ['#382f5a', '#dc8add'], icon: '♫', description: '演出与音乐节', shapeKey: 'music',
        settings: { density: 1.02, gap: 0.022, placementMode: 'organic', photoShape: 'circle', smartPlacement: true, mixedSizes: true, rotationRange: 6, matrixColumns: 0 }
    },
    {
        id: 'cloud-diary', name: '云端日记', category: '旅行', palette: ['#487a9b', '#b8e3ff'], icon: '☁', description: '清新旅行风', shapeKey: 'cloud',
        settings: { density: 1, gap: 0.03, placementMode: 'organic', photoShape: 'circle', smartPlacement: true, mixedSizes: true, rotationRange: 2, matrixColumns: 0 }
    },
    {
        id: 'moon-memorial', name: '月光纪念册', category: '通用', palette: ['#292a55', '#d8d4ff'], icon: '☾', description: '安静柔和的纪念墙', shapeKey: 'moon',
        settings: { density: 1.08, gap: 0.018, placementMode: 'organic', photoShape: 'circle', smartPlacement: true, mixedSizes: true, rotationRange: 2, matrixColumns: 0 }
    },
    {
        id: 'flower-wedding', name: '花园婚礼', category: '婚礼', palette: ['#70435d', '#f4b8cb'], icon: '✿', description: '花瓣环绕的甜蜜瞬间', shapeKey: 'flower',
        settings: { density: 1.05, gap: 0.026, placementMode: 'organic', photoShape: 'circle', smartPlacement: true, mixedSizes: true, rotationRange: 4, matrixColumns: 0 }
    },
    {
        id: 'baby-steps', name: '宝宝初成长', category: '生活', palette: ['#52647a', '#ffd6a5'], icon: '♧', description: '记录新生与第一次', shapeKey: 'stroller',
        settings: { density: 1, gap: 0.024, placementMode: 'brick', photoShape: 'circle', smartPlacement: true, mixedSizes: true, rotationRange: 2, matrixColumns: 0 }
    },
    {
        id: 'dog-companion', name: '汪星日常', category: '生活', palette: ['#614a3a', '#ddb892'], icon: '◆', description: '狗狗陪伴影集', shapeKey: 'dog',
        settings: { density: 1.04, gap: 0.026, placementMode: 'organic', photoShape: 'circle', smartPlacement: true, mixedSizes: true, rotationRange: 5, matrixColumns: 0 }
    },
    {
        id: 'rabbit-childhood', name: '童趣兔兔', category: '生日', palette: ['#6d4b70', '#f5c2e7'], icon: '♢', description: '儿童生日与亲子时光', shapeKey: 'rabbit',
        settings: { density: 1, gap: 0.03, placementMode: 'organic', photoShape: 'circle', smartPlacement: true, mixedSizes: true, rotationRange: 4, matrixColumns: 0 }
    },
    {
        id: 'ocean-notes', name: '海边手记', category: '旅行', palette: ['#125b73', '#71d6d0'], icon: '◁', description: '海岛与潜水旅程', shapeKey: 'fish',
        settings: { density: 1.08, gap: 0.018, placementMode: 'brick', photoShape: 'square', smartPlacement: true, mixedSizes: true, rotationRange: 3, matrixColumns: 0 }
    },
    {
        id: 'mountain-journey', name: '山野远行', category: '旅行', palette: ['#314b3f', '#a8c686'], icon: '▲', description: '徒步露营风景集', shapeKey: 'mountain',
        settings: { density: 1.1, gap: 0.016, placementMode: 'organic', photoShape: 'square', smartPlacement: true, mixedSizes: true, rotationRange: 5, matrixColumns: 0 }
    },
    {
        id: 'reading-years', name: '书香岁月', category: '毕业', palette: ['#493b63', '#d7c2ef'], icon: '▤', description: '读书与校园记录', shapeKey: 'book',
        settings: { density: 1.02, gap: 0.018, placementMode: 'brick', photoShape: 'square', smartPlacement: true, mixedSizes: true, rotationRange: 1, matrixColumns: 0 }
    },
    {
        id: 'champion-day', name: '冠军时刻', category: '毕业', palette: ['#4f3d20', '#ffd166'], icon: '♛', description: '比赛获奖与里程碑', shapeKey: 'trophy',
        settings: { density: 1.04, gap: 0.018, placementMode: 'grid', photoShape: 'diamond', smartPlacement: true, mixedSizes: true, rotationRange: 2, matrixColumns: 0 }
    },
    {
        id: 'winter-wishes', name: '冬日祝福', category: '节日', palette: ['#294c60', '#d9f0ff'], icon: '❄', description: '冰雪与新年聚会', shapeKey: 'snowflake',
        settings: { density: 1.12, gap: 0.012, placementMode: 'organic', photoShape: 'hexagon', smartPlacement: true, mixedSizes: true, rotationRange: 4, matrixColumns: 0 }
    },
    {
        id: 'lucky-clover', name: '幸运四叶草', category: '节日', palette: ['#24533f', '#8bd49c'], icon: '✤', description: '春日祝福与好运', shapeKey: 'clover',
        settings: { density: 1.06, gap: 0.022, placementMode: 'organic', photoShape: 'circle', smartPlacement: true, mixedSizes: true, rotationRange: 3, matrixColumns: 0 }
    },
    {
        id: 'planet-dreams', name: '星球漫游', category: '社交', palette: ['#33346e', '#a8a4ff'], icon: '◎', description: '科幻展览与夜空影集', shapeKey: 'planet',
        settings: { density: 1.08, gap: 0.018, placementMode: 'organic', photoShape: 'circle', smartPlacement: true, mixedSizes: true, rotationRange: 5, matrixColumns: 0 }
    },
    {
        id: 'green-life', name: '绿意生活', category: '生活', palette: ['#335c45', '#a7d49b'], icon: '◒', description: '花草、美食与慢生活', shapeKey: 'leaf',
        settings: { density: 1.06, gap: 0.022, placementMode: 'brick', photoShape: 'circle', smartPlacement: true, mixedSizes: true, rotationRange: 3, matrixColumns: 0 }
    },
    {
        id: 'holiday-bell', name: '节日铃声', category: '节日', palette: ['#6b2737', '#f1c75b'], icon: '♧', description: '圣诞与跨年合影', shapeKey: 'bell',
        settings: { density: 1.04, gap: 0.02, placementMode: 'organic', photoShape: 'circle', smartPlacement: true, mixedSizes: true, rotationRange: 3, matrixColumns: 0 }
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
        Math.abs(wall.rotationRange - settings.rotationRange) < 0.0001 &&
        (Number(wall.matrixColumns) || 0) === (Number(settings.matrixColumns) || 0);
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
    wall.matrixColumns = Number(settings.matrixColumns) || 0;
    if (preset.shapeKey) {
        wall.shapeKey = preset.shapeKey;
        wall.shape = shape;
    }
    if (wall.shape) wall.generateLayout();
    return preset;
}
