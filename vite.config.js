import { defineConfig } from 'vite';

var mobileHost = process.env.TAURI_DEV_HOST;

export default defineConfig({
    clearScreen: false,
    base: './',
    // ffmpeg.wasm creates its own module worker. Pre-bundling rewrites the
    // worker-relative URL to a non-existent optimize-deps path in development.
    optimizeDeps: {
        exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util', '@ffmpeg/core']
    },
    build: {
        target: 'es2021',
        sourcemap: false,
        assetsInlineLimit: 0
    },
    server: {
        port: 5173,
        strictPort: true,
        host: mobileHost || '0.0.0.0',
        hmr: mobileHost ? { protocol: 'ws', host: mobileHost, port: 5174 } : undefined,
        watch: { ignored: ['**/src-tauri/**'] }
    }
});
