/**
 * Small shared normalization helpers used across the SDK.
 *
 * These are intentionally internal (not exported from the package entrypoints)
 * to keep the public surface minimal while still avoiding duplication.
 */
/** Trim and remove trailing slashes. */
export declare function normalizeBaseUrl(url: string): string;
/**
 * Normalize a CAIP-2 chain id, returning canonical `dusk:<id>` or "".
 *
 * - Namespace is lowercased
 * - Reference must be decimal digits
 */
export declare function normalizeCaip2ChainId(chainId: string): string;
/** Strip a leading 0x/0X prefix if present. */
export declare function strip0x(hex: string): string;
/** Shallowly remove keys with `undefined` values. */
export declare function compact(obj: Record<string, any>): any;
//# sourceMappingURL=normalize.d.ts.map