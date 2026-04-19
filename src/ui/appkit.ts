import { createDuskWallet, type DuskWallet, type DuskWalletOptions } from "../wallet.js";
import type { DuskWalletState } from "../types.js";
import { createDuskConnectModal, type DuskConnectModal, type DuskConnectModalOptions } from "./modal.js";

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
 * but for Dusk wallet discovery + provider selection).
 */
export function createDuskConnectKit(options: DuskConnectKitOptions = {}): DuskConnectKit {
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
