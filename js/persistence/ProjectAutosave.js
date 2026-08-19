// Compatibility facade. The V2 implementation keeps the public API stable
// while isolating autosave improvements for mobile platforms.
export {
    autosavePhotoMetadata,
    autosavePhotoFingerprint,
    createProjectAutosave
} from './ProjectAutosaveV2.js';
