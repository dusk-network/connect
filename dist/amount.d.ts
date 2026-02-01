/**
 * Amount helpers.
 *
 * The Dusk protocol uses Lux as the atomic unit:
 * 1 DUSK = 1e9 Lux.
 */
export declare const LUX_DECIMALS = 9;
export declare const LUX_SCALE: bigint;
/**
 * Best-effort BigInt conversion.
 */
export declare function safeBigInt(v: unknown, fallback?: bigint): bigint;
/**
 * Format a Lux bigint string into a human-readable DUSK string.
 */
export declare function formatLuxToDusk(luxStr: string | bigint | number): string;
/**
 * Clamp a decimal string to `maxDecimals`, trimming trailing zeroes.
 */
export declare function clampDecimals(numStr: string, maxDecimals?: number): string;
/**
 * Convenience helper: format Lux -> DUSK and clamp.
 */
export declare function formatLuxShort(luxStr: string | bigint | number, maxDecimals?: number): string;
/**
 * Parse a user-entered DUSK decimal string into Lux (atomic units) string.
 */
export declare function parseDuskToLux(duskStr: string): string;
//# sourceMappingURL=amount.d.ts.map