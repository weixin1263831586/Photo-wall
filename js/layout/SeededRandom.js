export function normalizeSeed(value) {
    var seed = Number(value);
    if (!Number.isFinite(seed)) seed = 1;
    seed = Math.trunc(seed) >>> 0;
    return seed || 1;
}

export function mixSeed(seed, value) {
    var mixed = (normalizeSeed(seed) ^ (Math.trunc(Number(value) || 0) >>> 0)) >>> 0;
    mixed = Math.imul(mixed ^ (mixed >>> 16), 2246822507);
    mixed = Math.imul(mixed ^ (mixed >>> 13), 3266489909);
    return (mixed ^ (mixed >>> 16)) >>> 0;
}

/** Mulberry32: compact, deterministic and suitable for repeatable layouts. */
export function createSeededRandom(value) {
    var state = normalizeSeed(value);
    return function () {
        state = (state + 0x6D2B79F5) >>> 0;
        var result = state;
        result = Math.imul(result ^ (result >>> 15), result | 1);
        result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
        return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
    };
}
