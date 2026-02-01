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
export type DuskDataDriver = {
    init?: () => number | void;
    /** Encodes JSON input into RKYV bytes */
    encodeInputFn: (fnName: string, json: string) => Uint8Array;
    /** Decodes RKYV input bytes into JSON */
    decodeInputFn: (fnName: string, rkyvBytes: Uint8Array) => any;
    /** Decodes RKYV output bytes into JSON */
    decodeOutputFn: (fnName: string, rkyvBytes: Uint8Array) => any;
    /** Decodes RKYV event bytes into JSON */
    decodeEvent: (eventName: string, rkyvBytes: Uint8Array) => any;
    /** Returns the contract's JSON schema */
    getSchema: () => any;
    /** Returns the contract's semantic version string */
    getVersion: () => string;
};
/**
 * Create a JS driver from a compiled WASM binary.
 */
export declare function loadWasmDataDriver(bytes: Uint8Array | ArrayBuffer): Promise<DuskDataDriver>;
export declare function fetchWasmDataDriver(url: string, opts?: {
    fetch?: typeof fetch;
    init?: RequestInit;
}): Promise<DuskDataDriver>;
//# sourceMappingURL=driver.d.ts.map