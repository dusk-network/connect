import { createDuskWallet } from "../wallet.js";
import { createDuskConnectModal } from "./modal.js";
/**
 * A tiny, framework-agnostic "connect kit" (conceptually similar to Reown/AppKit,
 * but for the single injected Dusk Wallet provider).
 */
export function createDuskConnectKit(options = {}) {
    const wallet = createDuskWallet(options.wallet);
    const modal = createDuskConnectModal(wallet, options.modal);
    return {
        wallet,
        modal,
        open: () => modal.open(),
        close: () => modal.close(),
        destroy: () => {
            modal.destroy();
            wallet.destroy();
        },
        subscribe: (fn) => wallet.subscribe(fn),
    };
}
//# sourceMappingURL=appkit.js.map