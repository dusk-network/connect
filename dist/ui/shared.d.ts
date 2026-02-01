import type { DuskWalletState } from "../types.js";
/** Internal UI-only status model shared by connect button and modal. */
export type WalletStatus = "missing" | "disconnected" | "locked" | "connected";
/**
 * Compute a simple wallet status from the injected wallet state.
 *
 * - missing: wallet not installed/injected
 * - disconnected: installed but not authorized
 * - locked: authorized but no accounts exposed
 * - connected: authorized with at least one account
 */
export declare function walletStatus(st: DuskWalletState | null | undefined): WalletStatus;
/** Best-effort label for the current network/chain for UI display. */
export declare function networkLabel(st: DuskWalletState | null | undefined): string;
/** Shorten long strings like account ids. */
export declare function shortenMiddle(s: string, left?: number, right?: number): string;
//# sourceMappingURL=shared.d.ts.map