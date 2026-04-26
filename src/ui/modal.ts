import type { DuskProviderInfo, DuskWalletState } from "../types.js";
import type { DuskWallet } from "../wallet.js";
import { networkLabel, shortenMiddle, walletStatus, type WalletStatus } from "./shared.js";
import { DCONNECT_UI_BASE_CSS } from "./styles.js";

export type DuskConnectModalOptions = {
  /** Optional app name shown in the header (e.g. "My dApp") */
  appName?: string;
  /** Where to send the user if no wallet is installed */
  installUrl?: string;
  /** Close the modal automatically after a successful connect. Default: true */
  closeOnConnect?: boolean;
  /** Force a UI theme. Default: auto (follows prefers-color-scheme). */
  theme?: "auto" | "dark" | "light";
};

export type DuskConnectModal = {
  open: () => void;
  close: () => void;
  destroy: () => void;
  isOpen: () => boolean;
};

type Status = WalletStatus;

const STATUS_TEXT: Record<Status, string> = {
  missing: "Wallet not installed",
  disconnected: "Not connected",
  locked: "Locked",
  connected: "Connected",
};

const PRIMARY_TEXT: Record<Status, string> = {
  missing: "Install wallet",
  disconnected: "Connect wallet",
  locked: "Unlock wallet",
  connected: "Disconnect",
};

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard?.writeText?.(text);
    return true;
  } catch {
    // ignore
  }

  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function walletLabel(st: DuskWalletState): string {
  return st.providerInfo?.name || "Choose wallet";
}

function connectTitle(appName: string | undefined): string {
  const app = (appName || "").trim();
  if (!app) return "Connect wallet";
  return /^connect\b/i.test(app) ? app : `Connect ${app}`;
}

function isDuskProvider(provider: DuskProviderInfo): boolean {
  const name = String(provider.name || "").trim().toLowerCase();
  const rdns = String(provider.rdns || "").trim().toLowerCase();
  return name === "dusk wallet" || rdns === "network.dusk.wallet" || rdns.endsWith(".dusk.wallet");
}

function providerInitial(provider: DuskProviderInfo): string {
  const initial = String(provider.name || "Wallet").trim().charAt(0).toUpperCase();
  return /^[A-Z0-9]$/.test(initial) ? initial : "W";
}

function providerAccent(provider: DuskProviderInfo): string {
  const rdns = String(provider.rdns || "").toLowerCase();
  if (rdns.includes("harbor")) return "#6FBF8E";
  return "#71B1FF";
}

function renderProviderIcon(provider: DuskProviderInfo): string {
  const icon = String(provider.icon || "").trim();
  if (isDuskProvider(provider)) {
    return `<span class="dconnect-provider-mark dconnect-provider-dusk" aria-hidden="true"></span>`;
  }
  if (!icon) {
    return `<span class="dconnect-provider-mark dconnect-provider-initial" style="--dconnect-provider-accent: ${providerAccent(provider)}" aria-hidden="true">${providerInitial(provider)}</span>`;
  }
  return `<img class="dconnect-provider-icon" src="${escapeHtml(icon)}" alt="" />`;
}

export function createDuskConnectModal(wallet: DuskWallet, options: DuskConnectModalOptions = {}): DuskConnectModal {
  if (typeof window === "undefined") {
    return { open: () => {}, close: () => {}, destroy: () => {}, isOpen: () => false };
  }

  const closeOnConnect = options.closeOnConnect !== false;

  let root: HTMLDivElement | null = null;
  let unsub: (() => void) | null = null;
  let open = false;
  let closing = false;
  let closeTimer: number | null = null;
  let lastStatus: Status | null = null;

  let $title: HTMLElement | null = null;
  let $status: HTMLElement | null = null;
  let $wallet: HTMLElement | null = null;
  let $account: HTMLElement | null = null;
  let $network: HTMLElement | null = null;
  let $copy: HTMLButtonElement | null = null;
  let $providers: HTMLElement | null = null;
  let $primary: HTMLButtonElement | null = null;
  let $hint: HTMLElement | null = null;

  const css = `
    ${DCONNECT_UI_BASE_CSS}

    .dconnect-overlay {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--dconnect-overlay-bg);
      animation: dconnect-fade-in var(--dconnect-dur-base) var(--dconnect-ease-out) both;
      backdrop-filter: blur(2px);
      -webkit-backdrop-filter: blur(2px);
    }

    .dconnect-overlay[data-state="closing"] {
      pointer-events: none;
      animation: dconnect-fade-out 180ms var(--dconnect-ease) both;
    }

    .dconnect-modal {
      width: min(460px, calc(100vw - 32px));
      border-radius: var(--dconnect-radius-lg);
      border: 1px solid var(--dconnect-border);
      box-shadow: var(--dconnect-shadow);
      overflow: hidden;
      color: var(--dconnect-foreground);
      font-family: var(--dconnect-font-sans);
      background: var(--dconnect-card);
      animation: dconnect-panel-in var(--dconnect-dur-slow) var(--dconnect-ease-out) both;
      transition:
        border-color var(--dconnect-dur-base) var(--dconnect-ease),
        box-shadow var(--dconnect-dur-base) var(--dconnect-ease);
    }

    .dconnect-overlay[data-state="closing"] .dconnect-modal {
      animation: dconnect-panel-out 180ms var(--dconnect-ease) both;
    }

    .dconnect-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 18px 20px;
      border-bottom: 1px solid var(--dconnect-border);
      background: var(--dconnect-card);
    }

    .dconnect-brand {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }

    .dconnect-mark {
      width: 22px;
      height: 32px;
      display: grid;
      place-items: center;
      color: var(--dconnect-foreground);
      flex: 0 0 auto;
      transition:
        color var(--dconnect-dur-base) var(--dconnect-ease),
        transform var(--dconnect-dur-fast) var(--dconnect-ease);
    }

    .dconnect-mark::before {
      content: "";
      width: 16px;
      height: 16px;
      display: block;
      background: currentColor;
      -webkit-mask: var(--dconnect-logo-mark) center / contain no-repeat;
      mask: var(--dconnect-logo-mark) center / contain no-repeat;
      transform-origin: center;
    }

    .dconnect-brand:hover .dconnect-mark {
      color: var(--dconnect-foreground);
      transform: translateY(-1px);
    }

    .dconnect-brand:hover .dconnect-mark::before {
      animation: dconnect-logo-pulse 540ms var(--dconnect-ease-out);
    }

    .dconnect-txt {
      min-width: 0;
    }

    .dconnect-title {
      margin: 0;
      font-size: 14px;
      font-weight: 500;
      line-height: 1.2;
    }

    .dconnect-sub {
      margin: 5px 0 0;
      font-size: 12px;
      line-height: 1.35;
      color: var(--dconnect-muted-foreground);
    }

    .dconnect-icon-btn {
      appearance: none;
      cursor: pointer;
      border: 1px solid transparent;
      background: transparent;
      color: var(--dconnect-foreground);
      width: 34px;
      height: 34px;
      border-radius: var(--dconnect-radius-sm);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition:
        background var(--dconnect-dur-base) var(--dconnect-ease),
        transform var(--dconnect-dur-fast) var(--dconnect-ease),
        border-color var(--dconnect-dur-base) var(--dconnect-ease),
        box-shadow var(--dconnect-dur-base) var(--dconnect-ease);
    }

    .dconnect-icon-btn svg {
      width: 16px;
      height: 16px;
      stroke: currentColor;
    }

    .dconnect-icon-btn:hover {
      border-color: var(--dconnect-border-strong);
      background: var(--dconnect-button-hover);
      box-shadow: none;
    }

    .dconnect-icon-btn:active {
      transform: translateY(1px);
    }

    .dconnect-icon-btn:focus-visible {
      outline: none;
      box-shadow: var(--dconnect-shadow-focus);
    }

    .dconnect-body {
      padding: 16px 20px 20px;
      display: grid;
      gap: 0;
    }

    .dconnect-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      min-height: 42px;
      padding: 10px 0;
      border-radius: 0;
      border: 0;
      border-bottom: 1px solid var(--dconnect-border);
      background: transparent;
    }

    .dconnect-row-data {
      transition:
        transform var(--dconnect-dur-fast) var(--dconnect-ease),
        background var(--dconnect-dur-base) var(--dconnect-ease),
        border-color var(--dconnect-dur-base) var(--dconnect-ease),
        box-shadow var(--dconnect-dur-base) var(--dconnect-ease);
    }

    .dconnect-row-data:hover {
      border-color: var(--dconnect-border);
      background: transparent;
      box-shadow: none;
      transform: none;
    }

    .dconnect-lab {
      font-family: var(--dconnect-font-mono);
      font-size: 10px;
      font-weight: 400;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--dconnect-muted-foreground);
    }

    .dconnect-val {
      font-size: 12px;
      font-family: var(--dconnect-font-mono);
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      color: var(--dconnect-foreground);
    }

    .dconnect-val span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 260px;
    }

    .dconnect-copy {
      appearance: none;
      height: 28px;
      min-width: 28px;
      padding: 0 10px;
      border-radius: var(--dconnect-radius-sm);
      background: transparent;
      border: 1px solid var(--dconnect-border);
      color: var(--dconnect-foreground);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition:
        background var(--dconnect-dur-base) var(--dconnect-ease),
        transform var(--dconnect-dur-fast) var(--dconnect-ease),
        border-color var(--dconnect-dur-base) var(--dconnect-ease),
        box-shadow var(--dconnect-dur-base) var(--dconnect-ease);
    }

    .dconnect-copy:hover {
      background: var(--dconnect-button-hover);
      border-color: var(--dconnect-border-strong);
      box-shadow: var(--dconnect-shadow-soft);
    }

    .dconnect-copy:active {
      transform: translateY(1px);
    }

    .dconnect-copy:focus-visible {
      outline: none;
      box-shadow: var(--dconnect-shadow-focus);
    }

    .dconnect-section {
      display: grid;
      gap: 8px;
      margin-top: 14px;
    }

    .dconnect-section-label {
      font-family: var(--dconnect-font-mono);
      font-size: 10px;
      font-weight: 400;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--dconnect-muted-foreground);
    }

    .dconnect-section-label::before {
      content: "[ ";
    }

    .dconnect-section-label::after {
      content: " ]";
    }

    .dconnect-provider-list {
      display: grid;
      gap: 10px;
    }

    .dconnect-provider {
      appearance: none;
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 11px 12px;
      border-radius: var(--dconnect-radius-sm);
      border: 1px solid var(--dconnect-border);
      background: var(--dconnect-card);
      color: inherit;
      cursor: pointer;
      transition:
        transform var(--dconnect-dur-fast) var(--dconnect-ease),
        border-color var(--dconnect-dur-base) var(--dconnect-ease),
        box-shadow var(--dconnect-dur-base) var(--dconnect-ease),
        background var(--dconnect-dur-base) var(--dconnect-ease);
    }

    .dconnect-provider:hover {
      transform: translateY(-1px);
      border-color: var(--dconnect-border-strong);
      box-shadow: var(--dconnect-shadow-soft);
    }

    .dconnect-provider:focus {
      outline: none;
    }

    .dconnect-provider:focus-visible {
      outline: none;
      border-color: var(--dconnect-primary);
      box-shadow: var(--dconnect-shadow-focus);
    }

    .dconnect-provider[data-selected="true"] {
      border-color: var(--dconnect-border-strong);
      background: var(--dconnect-popover);
      box-shadow: inset 3px 0 0 var(--dconnect-primary);
    }

    .dconnect-provider-main {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }

    .dconnect-provider-icon,
    .dconnect-provider-mark {
      width: 40px;
      height: 40px;
      border-radius: var(--dconnect-radius-sm);
      flex: 0 0 auto;
      display: grid;
      place-items: center;
      object-fit: cover;
      background: var(--dconnect-provider-icon-bg);
      border: 1px solid var(--dconnect-border);
    }

    .dconnect-provider-initial {
      color: var(--dconnect-provider-icon-fg);
      font-family: var(--dconnect-font-mono);
      font-size: 14px;
      font-weight: 500;
      box-shadow: inset 4px 0 0 var(--dconnect-provider-accent);
    }

    .dconnect-provider-dusk {
      color: var(--dconnect-provider-dusk-icon-fg);
    }

    .dconnect-provider-dusk::before {
      content: "";
      width: 20px;
      height: 20px;
      display: block;
      background: currentColor;
      -webkit-mask: var(--dconnect-logo-mark) center / contain no-repeat;
      mask: var(--dconnect-logo-mark) center / contain no-repeat;
      transform-origin: center;
    }

    .dconnect-provider:hover .dconnect-provider-dusk::before {
      animation: dconnect-logo-pulse 540ms var(--dconnect-ease-out);
    }

    .dconnect-provider-copy {
      min-width: 0;
      display: grid;
      gap: 2px;
      text-align: left;
    }

    .dconnect-provider-name {
      font-size: 13px;
      font-weight: 500;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .dconnect-provider-rdns {
      font-family: var(--dconnect-font-mono);
      font-size: 11px;
      color: var(--dconnect-muted-foreground);
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .dconnect-provider-tag {
      font-family: var(--dconnect-font-mono);
      font-size: 10px;
      font-weight: 400;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--dconnect-muted-foreground);
    }

    .dconnect-actions {
      display: flex;
      gap: 8px;
      margin-top: 12px;
    }

    .dconnect-btn {
      flex: 1;
      appearance: none;
      border: 1px solid var(--dconnect-border);
      border-radius: var(--dconnect-radius-sm);
      padding: 10px 12px;
      font-size: 13px;
      font-weight: 500;
      line-height: 1;
      cursor: pointer;
      user-select: none;
      -webkit-tap-highlight-color: transparent;
      background: var(--dconnect-secondary);
      color: var(--dconnect-secondary-foreground);
      transition:
        transform var(--dconnect-dur-fast) var(--dconnect-ease),
        background var(--dconnect-dur-base) var(--dconnect-ease),
        border-color var(--dconnect-dur-base) var(--dconnect-ease),
        box-shadow var(--dconnect-dur-base) var(--dconnect-ease);
    }

    .dconnect-btn:hover {
      transform: translateY(-1px);
      background: var(--dconnect-button-hover);
      border-color: var(--dconnect-border-strong);
      box-shadow: var(--dconnect-shadow-hover);
    }

    .dconnect-btn:active {
      transform: translateY(1px);
    }

    .dconnect-btn:focus-visible {
      outline: none;
      box-shadow: var(--dconnect-shadow-focus);
    }

    .dconnect-btn:disabled {
      opacity: 0.55;
      cursor: not-allowed;
      box-shadow: none;
    }

    .dconnect-btn-primary {
      border-color: transparent;
      color: var(--dconnect-control-primary-fg);
      background: var(--dconnect-control-primary-bg);
    }

    .dconnect-btn-primary:hover {
      background: var(--dconnect-control-primary-hover-bg);
      box-shadow: var(--dconnect-shadow);
    }

    .dconnect-btn-destructive {
      border-color: transparent;
      background: var(--dconnect-destructive);
      color: var(--dconnect-destructive-foreground);
    }

    .dconnect-hint {
      margin-top: 2px;
      font-size: 11.5px;
      line-height: 1.35;
      color: var(--dconnect-muted-foreground);
      min-height: 16px;
    }
  `;

  const renderProviders = (st: DuskWalletState) => {
    if (!$providers) return;

    const providers = st.availableProviders ?? [];
    if (providers.length === 0) {
      $providers.innerHTML = "";
      $providers.hidden = true;
      return;
    }

    $providers.hidden = false;
    $providers.innerHTML = providers
      .map((provider) => {
        const selected = provider.uuid === st.providerId;
        return `
          <button
            class="dconnect-provider"
            type="button"
            data-action="select-provider"
            data-provider-id="${escapeHtml(provider.uuid)}"
            data-selected="${selected ? "true" : "false"}"
          >
            <span class="dconnect-provider-main">
              ${renderProviderIcon(provider)}
              <span class="dconnect-provider-copy">
                <span class="dconnect-provider-name">${escapeHtml(provider.name)}</span>
                <span class="dconnect-provider-rdns">${escapeHtml(provider.rdns)}</span>
              </span>
            </span>
            <span class="dconnect-provider-tag">${selected ? "Selected" : "Available"}</span>
          </button>
        `;
      })
      .join("");
  };

  const ensureDom = () => {
    if (root) return;

    root = document.createElement("div");
    root.className = "dconnect-overlay";
    if (options.theme === "dark" || options.theme === "light") {
      root.dataset.theme = options.theme;
    }
    root.tabIndex = -1;
    root.innerHTML = `
      <style>${css}</style>
      <div class="dconnect-modal" role="dialog" aria-modal="true">
        <div class="dconnect-header">
          <div class="dconnect-brand">
            <div class="dconnect-mark" aria-hidden="true"></div>
            <div class="dconnect-txt">
              <div class="dconnect-title" id="dconnectTitle">${escapeHtml(connectTitle(options.appName))}</div>
              <div class="dconnect-sub">Choose a Dusk wallet, then approve access for this site.</div>
            </div>
          </div>
          <button class="dconnect-icon-btn" type="button" data-action="close" aria-label="Close">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="square">
              <path d="M6 6l12 12M18 6L6 18"></path>
            </svg>
          </button>
        </div>
        <div class="dconnect-body">
          <div class="dconnect-row dconnect-row-data"><div class="dconnect-lab">Status</div><div class="dconnect-val" id="dwcStatus">—</div></div>
          <div class="dconnect-row dconnect-row-data"><div class="dconnect-lab">Wallet</div><div class="dconnect-val"><span id="dwcWallet">—</span></div></div>
          <div class="dconnect-row dconnect-row-data">
            <div class="dconnect-lab">Account</div>
            <div class="dconnect-val"><span id="dwcAccount">—</span><button class="dconnect-copy" id="dwcCopy" type="button" data-action="copy" hidden>Copy</button></div>
          </div>
          <div class="dconnect-row dconnect-row-data"><div class="dconnect-lab">Network</div><div class="dconnect-val" id="dwcNetwork">—</div></div>
          <div class="dconnect-section">
            <div class="dconnect-section-label">Wallets</div>
            <div class="dconnect-provider-list" id="dwcProviders" hidden></div>
          </div>
          <div class="dconnect-actions">
            <button class="dconnect-btn dconnect-btn-primary" id="dwcPrimary" type="button" data-action="primary">—</button>
          </div>
          <div class="dconnect-hint" id="dwcHint"></div>
        </div>
      </div>
    `;

    $title = root.querySelector("#dconnectTitle");
    $status = root.querySelector("#dwcStatus");
    $wallet = root.querySelector("#dwcWallet");
    $account = root.querySelector("#dwcAccount");
    $network = root.querySelector("#dwcNetwork");
    $copy = root.querySelector("#dwcCopy");
    $providers = root.querySelector("#dwcProviders");
    $primary = root.querySelector("#dwcPrimary");
    $hint = root.querySelector("#dwcHint");

    root.addEventListener("click", async (e) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      if (target === root) {
        close();
        return;
      }

      const btn = target.closest("button[data-action]") as HTMLButtonElement | null;
      if (!btn) return;

      const action = btn.getAttribute("data-action") || "";
      if (action === "close") {
        close();
        return;
      }

      const st = wallet.state;
      const status = walletStatus(st);

      if (action === "copy") {
        const acct = st.accounts?.[0] || "";
        if (!acct) return;
        const ok = await copyToClipboard(acct);
        toast(ok ? "Copied" : "Copy failed");
        return;
      }

      if (action === "select-provider") {
        const providerId = btn.getAttribute("data-provider-id") || "";
        if (!providerId) return;
        await wallet.selectProvider(providerId);
        return;
      }

      if (action === "primary") {
        if (status === "missing") {
          if (options.installUrl) window.open(options.installUrl, "_blank", "noopener,noreferrer");
          return;
        }

        const needsSelection = st.availableProviders.length > 0 && !st.providerId;
        if (needsSelection) return;

        if (status === "connected") {
          await wallet.disconnect();
          return;
        }

        await wallet.connect();
      }
    });

    unsub = wallet.subscribe((st) => update(st));
    update(wallet.state);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };

  const toast = (msg: string) => {
    if (!$hint) return;
    $hint.textContent = msg;
    window.setTimeout(() => {
      if ($hint) $hint.textContent = "";
    }, 1200);
  };

  const update = (st: DuskWalletState) => {
    const status = walletStatus(st);
    const acct = st.accounts?.[0] || "";
    const net = networkLabel(st);
    const needsSelection = st.availableProviders.length > 0 && !st.providerId;

    if ($title) {
      const app = (options.appName || "").trim();
      if (status === "connected") {
        $title.textContent = app ? `Connected to ${app}` : "Wallet";
      } else if (needsSelection) {
        $title.textContent = app ? `Choose a wallet for ${app}` : "Choose wallet";
      } else {
        $title.textContent = connectTitle(app);
      }
    }

    if ($status) {
      $status.textContent = needsSelection ? "Choose wallet" : STATUS_TEXT[status];
    }

    if ($wallet) $wallet.textContent = walletLabel(st);
    if ($account) $account.textContent = acct ? shortenMiddle(acct, 10, 8) : "—";
    if ($network) $network.textContent = net || "—";
    if ($copy) $copy.hidden = !acct;

    renderProviders(st);

    if ($primary) {
      $primary.classList.toggle("dconnect-btn-destructive", status === "connected");
      $primary.classList.toggle("dconnect-btn-primary", status !== "connected");
      $primary.textContent = needsSelection ? "Select wallet" : PRIMARY_TEXT[status];
      $primary.disabled = needsSelection;
    }

    if ($hint) {
      if (needsSelection) {
        $hint.textContent = "Choose which Dusk wallet this site should use.";
      } else if (!st.installed && options.installUrl) {
        $hint.textContent = "Install a compatible Dusk wallet to continue.";
      }
    }

    if (open && closeOnConnect && lastStatus && lastStatus !== "connected" && status === "connected") {
      close();
    }
    lastStatus = status;
  };

  const openModal = () => {
    ensureDom();
    if (!root || open) return;
    if (closeTimer !== null) {
      window.clearTimeout(closeTimer);
      closeTimer = null;
    }
    closing = false;
    root.removeAttribute("data-state");
    if (!root.isConnected) document.body.appendChild(root);
    open = true;
    lastStatus = walletStatus(wallet.state);
    root.focus();
    window.addEventListener("keydown", onKeyDown);
  };

  const finishClose = () => {
    if (!root) return;
    if (closeTimer !== null) {
      window.clearTimeout(closeTimer);
      closeTimer = null;
    }
    closing = false;
    root.removeAttribute("data-state");
    root.remove();
  };

  const close = (immediate = false) => {
    if (!root || (!open && !closing)) return;
    open = false;
    closing = true;
    window.removeEventListener("keydown", onKeyDown);

    if (immediate) {
      finishClose();
      return;
    }

    root.setAttribute("data-state", "closing");
    if (closeTimer !== null) window.clearTimeout(closeTimer);
    closeTimer = window.setTimeout(() => finishClose(), 180);
  };

  const destroy = () => {
    close(true);
    try {
      unsub?.();
    } catch {
      // ignore
    }
    unsub = null;
    root = null;
    $title = $status = $wallet = $account = $network = $hint = null;
    $copy = $primary = null;
    $providers = null;
  };

  return {
    open: openModal,
    close,
    destroy,
    isOpen: () => open,
  };
}

function escapeHtml(input: string): string {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
