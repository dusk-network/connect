/**
 * Byte encoding helpers.
 *
 * The SDK mostly needs:
 * - hex <-> Uint8Array
 * - a tiny `toBytes()` helper for node calls
 */
export function isHexString(s) {
    return typeof s === "string" && /^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0;
}
export function hexToBytes(hex) {
    let s = String(hex || "").trim();
    if (s.startsWith("0x") || s.startsWith("0X"))
        s = s.slice(2);
    if (s === "")
        return new Uint8Array();
    if (!isHexString(s))
        throw new Error("Invalid hex");
    const out = new Uint8Array(s.length / 2);
    for (let i = 0; i < out.length; i++) {
        out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
}
export function bytesToHex(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let s = "";
    for (let i = 0; i < b.length; i++) {
        const v = b[i] ?? 0;
        s += v.toString(16).padStart(2, "0");
    }
    return s;
}
/**
 * Best-effort conversion of supported encodings to bytes.
 *
 * Supported:
 * - Uint8Array
 * - ArrayBuffer
 * - number[]
 * - hex string (0x.. or raw)
 */
export function toBytes(value) {
    if (value == null)
        return new Uint8Array();
    if (value instanceof Uint8Array)
        return value;
    if (value instanceof ArrayBuffer)
        return new Uint8Array(value);
    if (Array.isArray(value))
        return new Uint8Array(value);
    if (typeof value === "string") {
        const s = value.trim();
        if (s.startsWith("0x") || isHexString(s)) {
            return hexToBytes(s);
        }
    }
    throw new Error("Unsupported byte encoding (use hex string, Uint8Array, ArrayBuffer, or number[])");
}
//# sourceMappingURL=bytes.js.map