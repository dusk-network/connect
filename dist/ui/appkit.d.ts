import { type DuskWallet, type DuskWalletOptions } from "../wallet.js";
import type { DuskWalletState } from "../types.js";
import { type DuskConnectModal, type DuskConnectModalOptions } from "./modal.js";
export type DuskConnectKitOptions = {
    /** Wallet options (provider detection, refresh, etc.) */
    wallet?: DuskWalletOptions;
    /** Modal UI options */
    modal?: DuskConnectModalOptions;
};
export type DuskConnectKit = {
    wallet: DuskWallet;
    modal: DuskConnectModal;
    open: () => void;
    close: () => void;
    destroy: () => void;
    subscribe: (fn: (state: DuskWalletState) => void) => () => void;
};
/**
 * A tiny, framework-agnostic "connect kit" (conceptually similar to Reown/AppKit,
 * but for the single injected Dusk Wallet provider).
 */
export declare function createDuskConnectKit(options?: DuskConnectKitOptions): DuskConnectKit;
//# sourceMappingURL=appkit.d.ts.map