/**
 * Small shared normalization helpers used across the SDK.
 *
 * These are intentionally internal (not exported from the package entrypoints)
 * to keep the public surface minimal while still avoiding duplication.
 */

/** Trim and remove trailing slashes. */
export function normalizeBaseUrl(url: string): string {
  return String(url || "").trim().replace(/\/+$/, "");
}

/**
 * Normalize a CAIP-2 chain id, returning canonical `dusk:<id>` or "".
 *
 * - Namespace is lowercased
 * - Reference must be decimal digits
 */
export function normalizeCaip2ChainId(chainId: string): string {
  const cid = String(chainId || "").trim();
  if (!cid) return "";
  const idx = cid.indexOf(":");
  if (idx <= 0) return "";
  const ns = cid.slice(0, idx).toLowerCase();
  const ref = cid.slice(idx + 1);
  if (ns !== "dusk") return "";
  if (!/^\d+$/.test(ref)) return "";
  return `${ns}:${ref}`;
}

/** Strip a leading 0x/0X prefix if present. */
export function strip0x(hex: string): string {
  return String(hex || "").replace(/^0x/i, "");
}

/** Shallowly remove keys with `undefined` values. */
export function compact(obj: Record<string, any>): any {
  const out: any = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}
