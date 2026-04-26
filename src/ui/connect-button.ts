import type { DuskWalletState } from "../types.js";
import { createDuskWallet, type DuskWallet, type DuskWalletOptions } from "../wallet.js";
import { createDuskConnectModal, type DuskConnectModal } from "./modal.js";
import { networkLabel, shortenMiddle, walletStatus } from "./shared.js";
import { DCONNECT_UI_BASE_CSS } from "./styles.js";

export type DuskConnectButtonOptions = {
  /** App name shown in the modal header (e.g. "My dApp"). */
  appName?: string;
  /** Where to send the user if the wallet isn't installed (extension store link). */
  installUrl?: string;
  /** Close the modal automatically after a successful connect. Default: true. */
  closeOnConnect?: boolean;
  /** Hide the small network badge on the right side of the button. */
  hideNetwork?: boolean;
  /** Override the default label when disconnected. Default: "Connect wallet" */
  connectText?: string;
  /** Override the default label when locked. Default: "Unlock wallet" */
  lockedText?: string;
  /** Override the default label when missing. Default: "Install wallet" */
  installText?: string;
  /** Force a UI theme. Default: auto (follows prefers-color-scheme). */
  theme?: "auto" | "dark" | "light";
  /** Provide a wallet instance. If omitted, the button creates its own wallet. */
  wallet?: DuskWallet;
  /** Options used if the button creates its own wallet. */
  walletOptions?: DuskWalletOptions;
  /** Provide a modal instance. If omitted, the button creates its own modal. */
  modal?: DuskConnectModal;
};

type Status = ReturnType<typeof walletStatus>;

function boolAttr(v: string | null): boolean {
  return v !== null && v.toLowerCase() !== "false";
}

// `networkLabel` is shared with the modal.

export class DuskConnectButtonElement extends HTMLElement {
  static get observedAttributes() {
    return [
      "app-name",
      "install-url",
      "close-on-connect",
      "hide-network",
      "connect-text",
      "locked-text",
      "install-text",
      "theme",
      "size",
      "variant",
    ];
  }

  private _shadow: ShadowRoot;

  private _wallet: DuskWallet | null = null;
  private _modal: DuskConnectModal | null = null;
  private _walletOptions: DuskWalletOptions | undefined;

  private _ownsWallet = false;
  private _ownsModal = false;
  private _unsub: (() => void) | null = null;

  private _btn: HTMLButtonElement | null = null;
  private _avatar: HTMLSpanElement | null = null;
  private _label: HTMLSpanElement | null = null;
  private _net: HTMLSpanElement | null = null;

  private _latest: DuskWalletState | null = null;

  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: "open" });
  }

  get state(): DuskWalletState | null {
    return this._latest ? { ...this._latest, accounts: [...this._latest.accounts] } : null;
  }

  get wallet(): DuskWallet | null {
    return this._wallet;
  }

  set wallet(w: DuskWallet | null) {
    if (w === this._wallet) return;
    this._setWallet(w, false);
  }

  get modal(): DuskConnectModal | null {
    return this._modal;
  }

  set modal(m: DuskConnectModal | null) {
    if (m === this._modal) return;
    if (this._ownsModal && this._modal) {
      try {
        this._modal.destroy();
      } catch {
        // ignore
      }
    }
    this._modal = m;
    this._ownsModal = false;
  }

  get walletOptions(): DuskWalletOptions | undefined {
    return this._walletOptions;
  }

  set walletOptions(opts: DuskWalletOptions | undefined) {
    this._walletOptions = opts;
  }

  open(): void {
    this._ensureWalletAndModal();
    this._modal?.open();
  }

  close(): void {
    this._modal?.close();
  }

  destroy(): void {
    if (this._unsub) {
      try {
        this._unsub();
      } catch {
        // ignore
      }
      this._unsub = null;
    }

    if (this._ownsModal && this._modal) {
      try {
        this._modal.destroy();
      } catch {
        // ignore
      }
    }
    this._modal = null;
    this._ownsModal = false;

    if (this._ownsWallet && this._wallet) {
      try {
        this._wallet.destroy();
      } catch {
        // ignore
      }
    }
    this._wallet = null;
    this._ownsWallet = false;

    this._latest = null;
  }

  connectedCallback(): void {
    this._renderShell();
    this._ensureWalletAndModal();
    this._update(this._wallet?.state ?? this._latest);
  }

  disconnectedCallback(): void {
    this.destroy();
  }

  attributeChangedCallback(): void {
    this._applyAttrsToShell();
    this._update(this._latest);

    // If we own the modal, rebuild it so header/install url/close behavior stays in sync.
    if (this._ownsModal && this._modal) {
      try {
        this._modal.destroy();
      } catch {
        // ignore
      }
      this._modal = null;
      this._ownsModal = false;
      // Re-create lazily on next open/interaction.
    }
  }

  // ------------------------------
  // Internals
  // ------------------------------

  private _renderShell(): void {
    if (this._btn) return;

    const css = `
      ${DCONNECT_UI_BASE_CSS}

      :host {
        display: inline-block;
      }

      button {
        appearance: none;
        display: inline-flex;
        align-items: center;
        gap: 10px;
        max-width: 100%;
        min-width: 0;
        cursor: pointer;
        user-select: none;
        white-space: nowrap;
        -webkit-tap-highlight-color: transparent;

        border-radius: var(--dconnect-radius);
        padding: 10px 14px;
        font-family: var(--dconnect-font-sans);
        font-weight: 500;
        font-size: 13px;
        line-height: 1;
        letter-spacing: 0;

        border: 1px solid var(--dconnect-button-border);
        background: var(--dconnect-button-bg);
        color: var(--dconnect-foreground);
        box-shadow: 0 0 0 rgba(0, 0, 0, 0);

        transition:
          transform var(--dconnect-dur-fast) var(--dconnect-ease),
          background var(--dconnect-dur-base) var(--dconnect-ease),
          border-color var(--dconnect-dur-base) var(--dconnect-ease),
          box-shadow var(--dconnect-dur-base) var(--dconnect-ease);
      }

      button:hover {
        transform: translateY(-1px);
        background: var(--dconnect-button-hover);
        border-color: var(--dconnect-border-strong);
        box-shadow: var(--dconnect-shadow-hover);
      }

      button:active {
        transform: translateY(1px);
      }

      button:focus-visible {
        outline: none;
        box-shadow: var(--dconnect-shadow-focus);
      }

      button:disabled {
        opacity: 0.55;
        cursor: not-allowed;
        box-shadow: none;
      }

      /* Primary treatment when not connected (solid variant) */
      button[data-variant="solid"][data-status="missing"],
      button[data-variant="solid"][data-status="disconnected"],
      button[data-variant="solid"][data-status="locked"] {
        color: var(--dconnect-primary-foreground);
        border-color: transparent;
        background: var(--dconnect-primary-gradient);
      }

      button[data-variant="solid"][data-status="missing"]:hover,
      button[data-variant="solid"][data-status="disconnected"]:hover,
      button[data-variant="solid"][data-status="locked"]:hover {
        background: var(--dconnect-primary-gradient-hover);
        box-shadow: var(--dconnect-shadow);
      }

      .avatar {
        flex: 0 0 auto;
        width: 18px;
        height: 18px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-family: var(--dconnect-font-mono);
        font-weight: 500;
        font-size: 12px;
        color: var(--dconnect-avatar-fg);
        background: transparent;
        transition:
          color var(--dconnect-dur-base) var(--dconnect-ease),
          transform var(--dconnect-dur-fast) var(--dconnect-ease);
      }

      .avatar::before {
        content: "";
        width: 16px;
        height: 16px;
        display: block;
        background: currentColor;
        -webkit-mask: var(--dconnect-logo-mark) center / contain no-repeat;
        mask: var(--dconnect-logo-mark) center / contain no-repeat;
        transform-origin: center;
      }

      button:hover .avatar {
        color: var(--dconnect-primary-hover);
      }

      button:hover .avatar::before {
        animation: dconnect-logo-pulse 540ms var(--dconnect-ease-out);
      }

      button[data-variant="solid"][data-status="missing"] .avatar,
      button[data-variant="solid"][data-status="disconnected"] .avatar,
      button[data-variant="solid"][data-status="locked"] .avatar {
        color: var(--dconnect-primary-foreground);
      }

      button[data-variant="solid"][data-status="missing"]:hover .avatar,
      button[data-variant="solid"][data-status="disconnected"]:hover .avatar,
      button[data-variant="solid"][data-status="locked"]:hover .avatar {
        color: var(--dconnect-primary-foreground);
      }

      .label {
        display: inline-flex;
        align-items: center;
        min-width: 0;
        max-width: 18ch;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .net {
        flex: 0 0 auto;
        padding: 4px 7px;
        border-radius: var(--dconnect-radius-sm);
        font-family: var(--dconnect-font-mono);
        font-weight: 500;
        font-size: 10px;
        line-height: 1;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        border: 1px solid rgba(113, 177, 255, 0.28);
        background: rgba(113, 177, 255, 0.12);
        color: var(--dconnect-primary);
        transition:
          background var(--dconnect-dur-base) var(--dconnect-ease),
          border-color var(--dconnect-dur-base) var(--dconnect-ease),
          color var(--dconnect-dur-base) var(--dconnect-ease);
      }

      button:hover .net {
        border-color: rgba(113, 177, 255, 0.42);
        background: rgba(113, 177, 255, 0.18);
      }

      /* size */
      button[data-size="sm"] {
        padding: 8px 12px;
        font-size: 12px;
      }
      button[data-size="sm"] .avatar {
        width: 17px;
        height: 17px;
      }
      button[data-size="lg"] {
        padding: 12px 16px;
        font-size: 14px;
      }
      button[data-size="lg"] .avatar {
        width: 20px;
        height: 20px;
      }

      /* variant */
      button[data-variant="outline"] {
        background: transparent;
        border-color: var(--dconnect-border-strong);
      }
      button[data-variant="solid"] {
        background: var(--dconnect-button-bg);
      }
    `;

    this._shadow.innerHTML = `
      <style>${css}</style>
      <button type="button">
        <span class="avatar" part="avatar" aria-hidden="true"></span>
        <span class="label" part="label">Connect wallet</span>
        <span class="net" part="network"></span>
      </button>
    `;

    this._btn = this._shadow.querySelector("button");
    this._avatar = this._shadow.querySelector(".avatar");
    this._label = this._shadow.querySelector(".label");
    this._net = this._shadow.querySelector(".net");

    this._btn?.addEventListener("click", () => this._onClick());
    this._applyAttrsToShell();
  }

  private _applyAttrsToShell(): void {
    if (!this._btn) return;
    const size = (this.getAttribute("size") || "md").toLowerCase();
    const variant = (this.getAttribute("variant") || "solid").toLowerCase();
    this._btn.setAttribute("data-size", size);
    this._btn.setAttribute("data-variant", variant);
  }

  private _onClick(): void {
    this._ensureWalletAndModal();
    const st = this._wallet?.state ?? this._latest;
    const status = walletStatus(st);

    // If missing + installUrl, behave like a direct CTA.
    if (status === "missing") {
      const url = this.getAttribute("install-url") || "";
      if (url) {
        window.open(url, "_blank", "noopener,noreferrer");
        return;
      }
    }

    this._modal?.open();
  }

  private _ensureWalletAndModal(): void {
    // Wallet
    if (!this._wallet) {
      this._setWallet(createDuskWallet(this._walletOptions), true);
    }

    // Modal
    if (!this._modal && this._wallet) {
      const appName = this.getAttribute("app-name") || "";
      const installUrl = this.getAttribute("install-url") || "";
      const theme = (this.getAttribute("theme") || "auto").toLowerCase();

      // With `exactOptionalPropertyTypes`, do not set optionals to `undefined`.
      const modalOpts: any = {};
      if (appName) modalOpts.appName = appName;
      if (installUrl) modalOpts.installUrl = installUrl;
      if (theme === "dark" || theme === "light") modalOpts.theme = theme;
      if (this.hasAttribute("close-on-connect")) {
        modalOpts.closeOnConnect = boolAttr(this.getAttribute("close-on-connect"));
      }

      this._modal = createDuskConnectModal(this._wallet, modalOpts);
      this._ownsModal = true;
    }
  }

  private _setWallet(wallet: DuskWallet | null, owns: boolean): void {
    // Cleanup old
    if (this._unsub) {
      try {
        this._unsub();
      } catch {
        // ignore
      }
      this._unsub = null;
    }
    if (this._ownsModal && this._modal) {
      try {
        this._modal.destroy();
      } catch {
        // ignore
      }
      this._modal = null;
      this._ownsModal = false;
    }
    if (this._ownsWallet && this._wallet) {
      try {
        this._wallet.destroy();
      } catch {
        // ignore
      }
    }

    this._wallet = wallet;
    this._ownsWallet = owns;

    if (this._wallet) {
      this._unsub = this._wallet.subscribe((st) => this._update(st));
      // Make sure we have at least one refresh.
      this._wallet.ready().catch(() => {});
      this._update(this._wallet.state);
    } else {
      this._update(null);
    }
  }

  private _update(st: DuskWalletState | null): void {
    this._latest = st;

    // Emit state event for host apps.
    try {
      this.dispatchEvent(
        new CustomEvent("dusk-state", { detail: st, bubbles: true, composed: true })
      );
    } catch {
      // ignore
    }

    // Keep status on the button for styling.
    const status = walletStatus(st);
    if (this._btn) this._btn.setAttribute("data-status", status);

    if (!this._label || !this._avatar || !this._net) return;

    const connectText = this.getAttribute("connect-text") || "Connect wallet";
    const lockedText = this.getAttribute("locked-text") || "Unlock wallet";
    const installText = this.getAttribute("install-text") || "Install wallet";
    const hideNetwork = boolAttr(this.getAttribute("hide-network"));

    // status already computed above

    // network badge
    if (hideNetwork || !st || status !== "connected") {
      this._net.textContent = "";
      this._net.style.display = "none";
    } else {
      const net = networkLabel(st);
      this._net.textContent = net;
      this._net.style.display = net ? "inline-flex" : "none";
    }

    const setDefault = (text: string) => {
      this._label!.textContent = text;
      this._avatar!.textContent = "";
      this._avatar!.style.background = "";
    };

    if (status !== "connected") {
      setDefault(status === "missing" ? installText : status === "locked" ? lockedText : connectText);
      return;
    }

    // connected
    const acct = st?.accounts?.[0] || "";
    this._label.textContent = acct ? shortenMiddle(acct, 6, 4) : "Connected";
    this._avatar.textContent = "";
    this._avatar.style.background = "";
  }
}

export function defineDuskConnectButton(tagName = "dusk-connect-button"): void {
  if (typeof window === "undefined") return;
  if (customElements.get(tagName)) return;
  customElements.define(tagName, DuskConnectButtonElement);
}

/**
 * Programmatic helper if you prefer not to write the custom element in HTML.
 */
export function createDuskConnectButton(options: DuskConnectButtonOptions = {}): DuskConnectButtonElement {
  defineDuskConnectButton();
  const el = document.createElement("dusk-connect-button") as DuskConnectButtonElement;

  if (options.appName) el.setAttribute("app-name", options.appName);
  if (options.installUrl) el.setAttribute("install-url", options.installUrl);
  if (options.closeOnConnect !== undefined) el.setAttribute("close-on-connect", String(options.closeOnConnect));
  if (options.hideNetwork) el.setAttribute("hide-network", "");
  if (options.connectText) el.setAttribute("connect-text", options.connectText);
  if (options.lockedText) el.setAttribute("locked-text", options.lockedText);
  if (options.installText) el.setAttribute("install-text", options.installText);
  if (options.theme && options.theme !== "auto") el.setAttribute("theme", options.theme);

  if (options.walletOptions) el.walletOptions = options.walletOptions;
  if (options.wallet) el.wallet = options.wallet;
  if (options.modal) el.modal = options.modal;

  return el;
}

// Auto-define for convenience in browser contexts.
try {
  defineDuskConnectButton();
} catch {
  // ignore
}
