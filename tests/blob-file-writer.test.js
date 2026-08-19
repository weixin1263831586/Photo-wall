import test from 'node:test';
import assert from 'node:assert/strict';
import { writeBlobToFile, readFileAsBlob } from '../js/platform/BlobFileWriter.js';

function memoryFile() {
    var contents = new Map();
    return {
        writes: [],
        readFile: function (path) {
            if (!contents.has(path)) throw new Error('file not found: ' + path);
            return Promise.resolve(contents.get(path));
        }
    };
}

function chunkedFile() {
    var contents = new Map();
    function chunkReader(bytes, offset) {
        return {
            read: function (buffer) {
                var remaining = bytes.byteLength - offset;
                if (remaining <= 0) return Promise.resolve(null);
                var nread = Math.min(buffer.byteLength, remaining);
                buffer.set(bytes.subarray(offset, offset + nread), 0);
                offset += nread;
                return Promise.resolve(nread);
            },
            close: function () { return Promise.resolve(); }
        };
    }
    return {
        files: contents,
        writeFile: function (path, data, options) {
            var append = Boolean(options && options.append);
            var previous = append && contents.has(path) ? contents.get(path) : new Uint8Array(0);
            var merged = new Uint8Array(previous.byteLength + data.byteLength);
            merged.set(previous, 0);
            merged.set(data, previous.byteLength);
            contents.set(path, merged);
            return Promise.resolve();
        },
        open: function (path) {
            if (!contents.has(path)) return Promise.reject(new Error('file not found: ' + path));
            return Promise.resolve(chunkReader(contents.get(path), 0));
        }
    };
}

test('writeBlobToFile writes in bounded chunks and preserves bytes', async function () {
    var fs = chunkedFile();
    var payload = new Uint8Array(5 * 1024 * 1024 + 1234);
    for (var i = 0; i < payload.length; i++) payload[i] = i & 0xff;
    await writeBlobToFile(new Blob([payload]), fs, 'cache/input.mp4', { chunkSize: 1024 * 1024 });
    var written = fs.files.get('cache/input.mp4');
    assert.equal(written.byteLength, payload.byteLength);
    assert.deepEqual(written, payload);
});

test('writeBlobToFile handles empty blobs and rejects non-blob sources', async function () {
    var fs = chunkedFile();
    await writeBlobToFile(new Blob([]), fs, 'cache/empty.mp4');
    assert.equal(fs.files.get('cache/empty.mp4').byteLength, 0);
    await assert.rejects(function () { return writeBlobToFile('not a blob', fs, 'x'); });
    await assert.rejects(function () { return writeBlobToFile(new Blob([1]), null, 'x'); });
});

test('readFileAsBlob reassembles chunked reads into a blob', async function () {
    var fs = chunkedFile();
    var payload = new Uint8Array(1024 * 1024 * 2 + 17);
    for (var i = 0; i < payload.length; i++) payload[i] = (i * 7) & 0xff;
    await fs.writeFile('cache/out.mp4', payload);
    var blob = await readFileAsBlob(fs, 'cache/out.mp4', 'video/mp4', { chunkSize: 512 * 1024 });
    assert.equal(blob.type, 'video/mp4');
    assert.equal(blob.size, payload.byteLength);
    assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), payload);
});

test('readFileAsBlob surfaces missing files and closes the handle', async function () {
    var fs = chunkedFile();
    var closed = [];
    fs.open = function (path) {
        if (path !== 'cache/exists') return Promise.reject(new Error('file not found'));
        return Promise.resolve({
            read: function () { return Promise.resolve(null); },
            close: function () { closed.push(path); return Promise.resolve(); }
        });
    };
    await assert.rejects(function () { return readFileAsBlob(fs, 'cache/missing.mp4'); });
    var empty = await readFileAsBlob(fs, 'cache/exists');
    assert.equal(empty.size, 0);
    assert.deepEqual(closed, ['cache/exists']);
});
