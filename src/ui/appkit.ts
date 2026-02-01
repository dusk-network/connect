import { createDuskWallet, type DuskWallet, type DuskWalletOptions } from "../wallet.js";
import type { DuskWalletState } from "../types.js";
import { createMochaviConnectModal, type MochaviConnectModal, type MochaviConnectModalOptions } from "./modal.js";

export type MochaviConnectKitOptions = {
  /** Wallet options (provider detection, refresh, etc.) */
  wallet?: DuskWalletOptions;
  /** Modal UI options */
  modal?: MochaviConnectModalOptions;
};

export type MochaviConnectKit = {
  wallet: DuskWallet;
  modal: MochaviConnectModal;
  open: () => void;
  close: () => void;
  destroy: () => void;
  subscribe: (fn: (state: DuskWalletState) => void) => () => void;
};

/**
 * A tiny, framework-agnostic "connect kit" (conceptually similar to Reown/AppKit,
 * but for the single injected Dusk Wallet provider).
 */
export function createMochaviConnectKit(options: MochaviConnectKitOptions = {}): MochaviConnectKit {
  const wallet = createDuskWallet(options.wallet);
  const modal = createMochaviConnectModal(wallet, options.modal);

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
