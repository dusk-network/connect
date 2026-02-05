import type { DuskWalletState } from "../types.js";
import { type DuskWallet, type DuskWalletOptions } from "../wallet.js";
import { type DuskConnectModal } from "./modal.js";
export type DuskConnectButtonOptions = {
    /** App name shown in the modal header (e.g. "My dApp"). */
    appName?: string;
    /** Where to send the user if the wallet isn't installed (extension store link). */
    installUrl?: string;
    /** Close the modal automatically after a successful connect. Default: true. */
    closeOnConnect?: boolean;
    /** Hide the small network badge on the right side of the button. */
    hideNetwork?: boolean;
    /** Override the default label when disconnected. Default: "Connect Wallet" */
    connectText?: string;
    /** Override the default label when locked. Default: "Unlock Wallet" */
    lockedText?: string;
    /** Override the default label when missing. Default: "Install Wallet" */
    installText?: string;
    /** Provide a wallet instance. If omitted, the button creates its own wallet. */
    wallet?: DuskWallet;
    /** Options used if the button creates its own wallet. */
    walletOptions?: DuskWalletOptions;
    /** Provide a modal instance. If omitted, the button creates its own modal. */
    modal?: DuskConnectModal;
};
export declare class DuskConnectButtonElement extends HTMLElement {
    static get observedAttributes(): string[];
    private _shadow;
    private _wallet;
    private _modal;
    private _walletOptions;
    private _ownsWallet;
    private _ownsModal;
    private _unsub;
    private _btn;
    private _avatar;
    private _label;
    private _net;
    private _latest;
    constructor();
    get state(): DuskWalletState | null;
    get wallet(): DuskWallet | null;
    set wallet(w: DuskWallet | null);
    get modal(): DuskConnectModal | null;
    set modal(m: DuskConnectModal | null);
    get walletOptions(): DuskWalletOptions | undefined;
    set walletOptions(opts: DuskWalletOptions | undefined);
    open(): void;
    close(): void;
    destroy(): void;
    connectedCallback(): void;
    disconnectedCallback(): void;
    attributeChangedCallback(): void;
    private _renderShell;
    private _applyAttrsToShell;
    private _onClick;
    private _ensureWalletAndModal;
    private _setWallet;
    private _update;
}
export declare function defineDuskConnectButton(tagName?: string): void;
/**
 * Programmatic helper if you prefer not to write the custom element in HTML.
 */
export declare function createDuskConnectButton(options?: DuskConnectButtonOptions): DuskConnectButtonElement;
//# sourceMappingURL=connect-button.d.ts.map