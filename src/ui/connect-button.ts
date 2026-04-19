import type { DuskWalletState } from "../types.js";
import { createDuskWallet, type DuskWallet, type DuskWalletOptions } from "../wallet.js";
import { createDuskConnectModal, type DuskConnectModal } from "./modal.js";
import { networkLabel, shortenMiddle, walletStatus } from "./shared.js";
import { MCONNECT_UI_BASE_CSS } from "./styles.js";

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

type Status = ReturnType<typeof walletStatus>;

function hashHue(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) >>> 0;
  return h % 360;
}

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
      ${MCONNECT_UI_BASE_CSS}

      :host {
        display: inline-block;
      }

      button {
        appearance: none;
        display: inline-flex;
        align-items: center;
        gap: 10px;
        cursor: pointer;
        user-select: none;
        white-space: nowrap;
        -webkit-tap-highlight-color: transparent;

        border-radius: var(--mconnect-radius-pill);
        padding: 10px 14px;
        font-family: var(--mconnect-font-sans);
        font-weight: 850;
        font-size: 12.5px;
        line-height: 1;

        border: 1px solid var(--mconnect-button-border);
        background: var(--mconnect-button-bg);
        color: var(--mconnect-foreground);

        transition:
          transform 90ms ease,
          background 160ms ease,
          border-color 160ms ease,
          box-shadow 160ms ease;
      }

      button:hover {
        background: var(--mconnect-button-hover);
        box-shadow: var(--mconnect-shadow-soft);
      }

      button:active {
        transform: translateY(1px);
      }

      button:focus-visible {
        outline: none;
        box-shadow: var(--mconnect-shadow-focus);
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
        color: var(--mconnect-primary-foreground);
        border-color: rgba(255, 255, 255, 0.12);
        background: var(--mconnect-primary-gradient);
      }

      button[data-variant="solid"][data-status="missing"]:hover,
      button[data-variant="solid"][data-status="disconnected"]:hover,
      button[data-variant="solid"][data-status="locked"]:hover {
        background: var(--mconnect-primary-gradient-hover);
        box-shadow: var(--mconnect-shadow);
      }

      .avatar {
        width: 26px;
        height: 26px;
        border-radius: var(--mconnect-radius-pill);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-weight: 900;
        font-size: 12px;
        background: var(--mconnect-avatar-gradient);
      }

      .label {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }

      .net {
        margin-left: 6px;
        padding: 4px 8px;
        border-radius: var(--mconnect-radius-pill);
        font-family: var(--mconnect-font-sans);
        font-weight: 800;
        font-size: 11px;
        line-height: 1;
        border: 1px solid var(--mconnect-border);
        background: rgba(0, 0, 0, 0.18);
        color: inherit;
        opacity: 0.92;
      }

      /* size */
      button[data-size="sm"] {
        padding: 8px 12px;
        font-size: 12px;
      }
      button[data-size="sm"] .avatar {
        width: 24px;
        height: 24px;
      }
      button[data-size="lg"] {
        padding: 12px 16px;
        font-size: 14px;
      }
      button[data-size="lg"] .avatar {
        width: 28px;
        height: 28px;
      }

      /* variant */
      button[data-variant="outline"] {
        background: transparent;
        border-color: var(--mconnect-border);
      }
      button[data-variant="solid"] {
        background: var(--mconnect-button-bg);
      }
    `;

    this._shadow.innerHTML = `
      <style>${css}</style>
      <button type="button">
        <span class="avatar" part="avatar">M</span>
        <span class="label" part="label">Connect Wallet</span>
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

      // With `exactOptionalPropertyTypes`, do not set optionals to `undefined`.
      const modalOpts: any = {};
      if (appName) modalOpts.appName = appName;
      if (installUrl) modalOpts.installUrl = installUrl;
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

    const connectText = this.getAttribute("connect-text") || "Connect Wallet";
    const lockedText = this.getAttribute("locked-text") || "Unlock Wallet";
    const installText = this.getAttribute("install-text") || "Install Wallet";
    const hideNetwork = boolAttr(this.getAttribute("hide-network"));

    // status already computed above

    // network badge
    if (hideNetwork || !st) {
      this._net.textContent = "";
      this._net.style.display = "none";
    } else {
      const net = networkLabel(st);
      this._net.textContent = net;
      this._net.style.display = net ? "inline-flex" : "none";
    }

    const defaultBg = "var(--mconnect-avatar-gradient)";
    const setDefault = (text: string) => {
      this._label!.textContent = text;
      this._avatar!.textContent = "D";
      this._avatar!.style.background = defaultBg;
    };

    if (status !== "connected") {
      setDefault(status === "missing" ? installText : status === "locked" ? lockedText : connectText);
      return;
    }

    // connected
    const acct = st?.accounts?.[0] || "";
    this._label.textContent = acct ? shortenMiddle(acct, 6, 4) : "Connected";
    const hue = hashHue(acct);
    const hue2 = (hue + 55) % 360;
    this._avatar.textContent = "";
    this._avatar.style.background = `linear-gradient(135deg, hsl(${hue} 85% 55%), hsl(${hue2} 85% 50%))`;
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
