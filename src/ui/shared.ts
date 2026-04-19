import type { DuskWalletState } from "../types.js";

/** Internal UI-only status model shared by connect button and modal. */
export type WalletStatus = "missing" | "disconnected" | "locked" | "connected";

/**
 * Compute a simple wallet status from the discovered wallet state.
 *
 * - missing: no compatible wallet discovered
 * - disconnected: installed but not authorized
 * - locked: authorized but no accounts exposed
 * - connected: authorized with at least one account
 */
export function walletStatus(st: DuskWalletState | null | undefined): WalletStatus {
  if (!st || !st.installed) return "missing";
  if (!st.authorized) return "disconnected";
  if (!st.accounts?.length) return "locked";
  return "connected";
}

/** Best-effort label for the current network/chain for UI display. */
export function networkLabel(st: DuskWalletState | null | undefined): string {
  if (!st) return "";
  const name = st.node?.networkName;
  if (name && typeof name === "string") return name;
  if (st.chainId) return st.chainId;
  return "";
}

/** Shorten long strings like account ids. */
export function shortenMiddle(s: string, left = 6, right = 4): string {
  if (!s) return "";
  if (s.length <= left + right + 3) return s;
  return `${s.slice(0, left)}…${s.slice(-right)}`;
}
