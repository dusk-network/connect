import type { DuskWallet } from "../wallet.js";
export type DuskConnectModalOptions = {
    /** Optional app name shown in the header (e.g. "My dApp") */
    appName?: string;
    /** Where to send the user if the wallet isn't installed */
    installUrl?: string;
    /** Close the modal automatically after a successful connect. Default: true */
    closeOnConnect?: boolean;
};
export type DuskConnectModal = {
    open: () => void;
    close: () => void;
    destroy: () => void;
    isOpen: () => boolean;
};
export declare function createDuskConnectModal(wallet: DuskWallet, options?: DuskConnectModalOptions): DuskConnectModal;
//# sourceMappingURL=modal.d.ts.map