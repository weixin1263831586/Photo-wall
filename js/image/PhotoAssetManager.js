// Compatibility facade. The V2 implementation keeps the public API stable
// while isolating Android-specific decode fallbacks and cache policy changes.
export { createBitmapLRU, createPhotoAssetManager } from './PhotoAssetManagerV2.js';
