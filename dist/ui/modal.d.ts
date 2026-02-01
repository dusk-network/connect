import type { DuskWallet } from "../wallet.js";
export type MochaviConnectModalOptions = {
    /** Optional app name shown in the header (e.g. "My dApp") */
    appName?: string;
    /** Where to send the user if the wallet isn't installed */
    installUrl?: string;
    /** Close the modal automatically after a successful connect. Default: true */
    closeOnConnect?: boolean;
};
export type MochaviConnectModal = {
    open: () => void;
    close: () => void;
    destroy: () => void;
    isOpen: () => boolean;
};
export declare function createMochaviConnectModal(wallet: DuskWallet, options?: MochaviConnectModalOptions): MochaviConnectModal;
//# sourceMappingURL=modal.d.ts.map