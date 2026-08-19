/**
 * Write a Blob to the native filesystem in bounded chunks.
 *
 * Passing a full `new Uint8Array(await blob.arrayBuffer())` to
 * `plugin-fs writeFile` serializes the whole file through the Tauri IPC
 * bridge, which allocates several live copies of the payload on the Android
 * WebView heap (typed array + JSON escape of the byte array). For large
 * videos (up to 200 MB) that reliably OOMs the WebView renderer and leaves
 * the app on a black screen. Slicing the blob keeps the peak JS memory at
 * roughly one chunk instead of multiples of the file size.
 */
var DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024;

export async function writeBlobToFile(blob, filesystem, path, options) {
    if (!(blob instanceof Blob)) throw new Error('A Blob source is required');
    if (!filesystem || typeof filesystem.writeFile !== 'function') {
        throw new Error('A filesystem writer is required');
    }
    options = options || {};
    var chunkSize = Math.max(64 * 1024, Number(options.chunkSize) || DEFAULT_CHUNK_SIZE);
    var offset = 0;
    var first = true;
    while (offset < blob.size) {
        var slice = blob.slice(offset, Math.min(blob.size, offset + chunkSize));
        var bytes = new Uint8Array(await slice.arrayBuffer());
        await filesystem.writeFile(path, bytes, { append: !first });
        first = false;
        offset += bytes.byteLength;
    }
    if (first) await filesystem.writeFile(path, new Uint8Array(0), { append: false });
}

/**
 * Read a file into a Blob in bounded chunks. Mirror of writeBlobToFile:
 * plugin-fs readFile serializes the whole file over IPC, so large videos
 * must be pulled back piecewise to keep the WebView heap flat.
 */
export async function readFileAsBlob(filesystem, path, mimeType, options) {
    if (!filesystem || typeof filesystem.open !== 'function') {
        throw new Error('A filesystem reader is required');
    }
    options = options || {};
    var chunkSize = Math.max(64 * 1024, Number(options.chunkSize) || DEFAULT_CHUNK_SIZE);
    var handle = await filesystem.open(path, { read: true });
    /* Wrap each chunk in its own Blob right away: Chromium pages blob data
       to disk and a composed Blob references those pages without copying,
       so the JS heap never holds the whole file. */
    var parts = [];
    try {
        var buffer = new Uint8Array(chunkSize);
        for (;;) {
            var nread = await handle.read(buffer);
            if (nread === null || nread === 0) break;
            parts.push(new Blob([buffer.slice(0, nread)]));
        }
        return new Blob(parts, { type: mimeType || 'application/octet-stream' });
    } finally {
        await handle.close();
    }
}

