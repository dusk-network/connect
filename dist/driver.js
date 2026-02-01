/**
 * Data-driver WASM loader (JS runtime bindings).
 *
 * A “data-driver” is a WASM module that knows how to:
 *  - encode JSON inputs for a contract function -> RKYV bytes
 *  - decode RKYV bytes from inputs/outputs/events -> JSON
 *
 * It does not perform on-chain calls; it only (de)serializes according to the
 * contract's ABI exposed via the Rust `ConvertibleContract` trait.
 */
const OUT_START = 64 * 1024;
const OUT_MAX = 2 * 1024 * 1024;
const OUT_TRIES = 6;
function u8(bytes) {
    return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}
function looksLikeBufferTooSmall(err) {
    const s = err.toLowerCase();
    return (s.includes("buffer") && s.includes("small")) || s.includes("insufficient") || s.includes("out_size");
}
/**
 * Create a JS driver from a compiled WASM binary.
 */
export async function loadWasmDataDriver(bytes) {
    const wasmBytes = u8(bytes);
    // `WebAssembly.instantiate` has slightly different typings across runtimes.
    // Runtime-wise, we can always grab `.instance` if present, else treat result as instance.
    const instantiated = await WebAssembly.instantiate(wasmBytes, { env: {} });
    const instance = instantiated.instance ?? instantiated;
    const exports = instance.exports;
    if (!exports?.memory || typeof exports.alloc !== "function" || typeof exports.dealloc !== "function") {
        throw new Error("Invalid data-driver WASM: missing required exports (memory/alloc/dealloc)");
    }
    const { memory } = exports;
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    const safeDealloc = (ptr, len) => {
        try {
            exports.dealloc(ptr, len);
        }
        catch {
            // ignore
        }
    };
    const allocBytes = (bytes) => {
        const ptr = exports.alloc(bytes.length);
        new Uint8Array(memory.buffer, ptr, bytes.length).set(bytes);
        return [ptr, bytes.length];
    };
    const withAllocBytes = (bytes, fn) => {
        const [ptr, len] = allocBytes(bytes);
        try {
            return fn(ptr, len);
        }
        finally {
            safeDealloc(ptr, len);
        }
    };
    const withAllocStr = (s, fn) => withAllocBytes(enc.encode(s), fn);
    const readOut = (ptr, outSize) => {
        const dv = new DataView(memory.buffer, ptr, 4);
        const n = dv.getUint32(0, true);
        if (n > outSize - 4)
            throw new Error(`Invalid output size: ${n}`);
        return new Uint8Array(memory.buffer, ptr + 4, n).slice();
    };
    const getLastError = () => {
        let outSize = 4 * 1024;
        for (let i = 0; i < 6; i++) {
            const bufSize = outSize;
            const outPtr = exports.alloc(bufSize);
            try {
                exports.get_last_error(outPtr, bufSize);
                return dec.decode(readOut(outPtr, bufSize));
            }
            catch (e) {
                // If the message didn't fit, retry a bit bigger.
                if (String(e?.message || "").includes("Invalid output size") && bufSize < 64 * 1024) {
                    outSize = bufSize * 2;
                    continue;
                }
                return "";
            }
            finally {
                safeDealloc(outPtr, bufSize);
            }
        }
        return "";
    };
    const callOut = (ffi) => {
        let outSize = OUT_START;
        for (let attempt = 0; attempt < OUT_TRIES; attempt++) {
            const bufSize = outSize;
            const outPtr = exports.alloc(bufSize);
            try {
                const code = ffi(outPtr, bufSize);
                if (code === 0)
                    return readOut(outPtr, bufSize);
                const err = getLastError();
                if (err && looksLikeBufferTooSmall(err) && bufSize < OUT_MAX) {
                    outSize = Math.min(bufSize * 2, OUT_MAX);
                    continue;
                }
                throw new Error(`FFI call failed (${code}): ${err || "unknown error"}`);
            }
            finally {
                safeDealloc(outPtr, bufSize);
            }
        }
        throw new Error("FFI call failed: output buffer too small (max retries reached)");
    };
    const parseJson = (bytes) => JSON.parse(dec.decode(bytes));
    const callStrBytes = (ffi, name, rkyvBytes) => withAllocStr(name, (namePtr, nameLen) => withAllocBytes(rkyvBytes, (bPtr, bLen) => callOut((outPtr, outSize) => ffi(namePtr, nameLen, bPtr, bLen, outPtr, outSize))));
    const callStrStr = (ffi, name, json) => withAllocStr(name, (namePtr, nameLen) => withAllocStr(json, (jsonPtr, jsonLen) => callOut((outPtr, outSize) => ffi(namePtr, nameLen, jsonPtr, jsonLen, outPtr, outSize))));
    return {
        encodeInputFn: (fnName, json) => callStrStr(exports.encode_input_fn, String(fnName), String(json)),
        decodeInputFn: (fnName, rkyvBytes) => parseJson(callStrBytes(exports.decode_input_fn, String(fnName), rkyvBytes)),
        decodeOutputFn: (fnName, rkyvBytes) => parseJson(callStrBytes(exports.decode_output_fn, String(fnName), rkyvBytes)),
        decodeEvent: (eventName, rkyvBytes) => parseJson(withAllocStr(String(eventName), (evPtr, evLen) => withAllocBytes(rkyvBytes, (bPtr, bLen) => callOut((outPtr, outSize) => exports.decode_event(evPtr, evLen, bPtr, bLen, outPtr, outSize))))),
        getSchema: () => parseJson(callOut((outPtr, outSize) => exports.get_schema(outPtr, outSize))),
        getVersion: () => dec.decode(callOut((outPtr, outSize) => exports.get_version(outPtr, outSize))),
        init: () => exports.init?.(),
    };
}
export async function fetchWasmDataDriver(url, opts = {}) {
    const f = opts.fetch ?? fetch;
    const res = await f(url, opts.init);
    if (!res.ok)
        throw new Error(`Failed to fetch data-driver wasm (${res.status} ${res.statusText})`);
    const buf = await res.arrayBuffer();
    const driver = await loadWasmDataDriver(new Uint8Array(buf));
    try {
        driver.init?.();
    }
    catch {
        // ignore
    }
    return driver;
}
//# sourceMappingURL=driver.js.map