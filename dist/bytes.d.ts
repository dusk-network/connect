/**
 * Byte encoding helpers.
 *
 * The SDK mostly needs:
 * - hex <-> Uint8Array
 * - a tiny `toBytes()` helper for node calls
 */
export declare function isHexString(s: unknown): s is string;
export declare function hexToBytes(hex: string): Uint8Array;
export declare function bytesToHex(bytes: ArrayBuffer | Uint8Array | number[]): string;
/**
 * Best-effort conversion of supported encodings to bytes.
 *
 * Supported:
 * - Uint8Array
 * - ArrayBuffer
 * - number[]
 * - hex string (0x.. or raw)
 */
export declare function toBytes(value: unknown): Uint8Array;
//# sourceMappingURL=bytes.d.ts.map