import type { SwitchChainParams } from "./types.js";
import type { DuskWallet } from "./wallet.js";
export type EnsureChainOptions = {
    /**
     * If true, the helper will call `wallet.refresh()` first (no prompt).
     * Default: true
     */
    refresh?: boolean;
    /**
     * If `nodeUrl` is provided and the wallet has emitted `duskNodeChanged`,
     * require the current `nodeUrl` to match exactly.
     * Default: false
     */
    strictNodeUrl?: boolean;
};
/**
 * Tiny helper that checks whether the wallet is already on a target chain / node
 * and only calls `wallet.switchChain()` if needed.
 *
 * @returns `true` if the helper initiated a switch (i.e. it will prompt the user), otherwise `false`.
 */
export declare function ensureChain(wallet: DuskWallet, target: SwitchChainParams, opts?: EnsureChainOptions): Promise<boolean>;
//# sourceMappingURL=ensureChain.d.ts.map