import { networkLabel, shortenMiddle, walletStatus } from "./shared.js";
import { MCONNECT_UI_BASE_CSS } from "./styles.js";
const STATUS_TEXT = {
    missing: "Wallet not installed",
    disconnected: "Not connected",
    locked: "Locked",
    connected: "Connected",
};
const PRIMARY_TEXT = {
    missing: "Install Wallet",
    disconnected: "Connect Wallet",
    locked: "Unlock Wallet",
    connected: "Disconnect",
};
// Shared: walletStatus, networkLabel, shortenMiddle
async function copyToClipboard(text) {
    try {
        await navigator.clipboard?.writeText?.(text);
        return true;
    }
    catch {
        // ignore
    }
    // Fallback
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
    }
    catch {
        return false;
    }
}
export function createDuskConnectModal(wallet, options = {}) {
    if (typeof window === "undefined") {
        return { open: () => { }, close: () => { }, destroy: () => { }, isOpen: () => false };
    }
    const closeOnConnect = options.closeOnConnect !== false;
    let root = null;
    let unsub = null;
    let open = false;
    let lastStatus = null;
    // Cached nodes
    let $title = null;
    let $status = null;
    let $account = null;
    let $network = null;
    let $copy = null;
    let $primary = null;
    let $hint = null;
    const css = `
    ${MCONNECT_UI_BASE_CSS}

    .mconnect-overlay {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--mconnect-overlay-bg);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
    }

    .mconnect-modal {
      width: min(440px, calc(100vw - 32px));
      border-radius: calc(var(--mconnect-radius) + 10px);
      border: 1px solid var(--mconnect-border);
      box-shadow: var(--mconnect-shadow);
      overflow: hidden;
      color: var(--mconnect-foreground);
      font-family: var(--mconnect-font-sans);
      background:
        radial-gradient(700px 260px at 10% -10%, rgba(122,162,255,0.18), transparent 60%),
        radial-gradient(520px 220px at 95% 10%, rgba(51,209,255,0.14), transparent 55%),
        var(--mconnect-background);
    }

    .mconnect-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--mconnect-border);
      background: rgba(5,7,12,0.72);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
    }

    .mconnect-brand {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }

    .mconnect-mark {
      width: 32px;
      height: 32px;
      border-radius: 12px;
      display: grid;
      place-items: center;
      background: var(--mconnect-primary);
      color: var(--mconnect-primary-foreground);
      font-weight: 900;
      letter-spacing: -0.03em;
      flex: 0 0 auto;
      box-shadow: 0 14px 32px rgba(122,162,255,0.25);
    }

    .mconnect-txt {
      min-width: 0;
    }

    .mconnect-title {
      margin: 0;
      font-size: 13px;
      font-weight: 900;
      line-height: 1.15;
    }

    .mconnect-sub {
      margin: 4px 0 0;
      font-size: 11.5px;
      line-height: 1.35;
      opacity: 0.75;
    }

    .mconnect-icon-btn {
      appearance: none;
      cursor: pointer;
      border: 1px solid var(--mconnect-border);
      background: rgba(0,0,0,0.18);
      color: var(--mconnect-foreground);
      width: 34px;
      height: 34px;
      border-radius: 12px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: background 140ms ease, transform 140ms ease, border-color 140ms ease, box-shadow 140ms ease;
    }

    .mconnect-icon-btn:hover {
      background: rgba(255,255,255,0.06);
      transform: translateY(-1px);
      box-shadow: var(--mconnect-shadow-soft);
    }

    .mconnect-icon-btn:active {
      transform: translateY(1px);
    }

    .mconnect-icon-btn:focus-visible {
      outline: none;
      box-shadow: var(--mconnect-shadow-focus);
    }

    .mconnect-body {
      padding: 16px;
      display: grid;
      gap: 10px;
    }

    .mconnect-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      border-radius: calc(var(--mconnect-radius) + 6px);
      border: 1px solid var(--mconnect-border);
      background: linear-gradient(180deg, rgba(255,255,255,0.03), rgba(0,0,0,0.18));
      box-shadow:
        0 1px 0 rgba(255,255,255,0.06) inset,
        0 14px 34px rgba(0,0,0,0.22);
    }

    /* "Data rows" (Account/Network): subtle glow on hover/focus without looking like inputs */
    .mconnect-row-data {
      transition: border-color 160ms ease, box-shadow 160ms ease;
    }

    .mconnect-row-data:hover {
      border-color: rgba(51, 209, 255, 0.22);
      box-shadow:
        0 1px 0 rgba(255,255,255,0.06) inset,
        0 14px 34px rgba(0,0,0,0.22),
        0 0 0 3px rgba(51, 209, 255, 0.16),
        0 0 28px rgba(122, 162, 255, 0.10);
    }

    .mconnect-row-data:focus-within {
      border-color: rgba(51, 209, 255, 0.28);
      box-shadow:
        0 1px 0 rgba(255,255,255,0.06) inset,
        0 14px 34px rgba(0,0,0,0.22),
        var(--mconnect-shadow-focus),
        0 0 30px rgba(51, 209, 255, 0.10);
    }

    .mconnect-lab {
      font-size: 11px;
      font-weight: 750;
      opacity: 0.75;
    }

    .mconnect-val {
      font-size: 12px;
      font-family: var(--mconnect-font-mono);
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    .mconnect-val span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 260px;
    }

    .mconnect-copy {
      appearance: none;
      height: 28px;
      min-width: 28px;
      padding: 0 10px;
      border-radius: 10px;
      background: rgba(0,0,0,0.18);
      border: 1px solid var(--mconnect-border);
      color: var(--mconnect-foreground);
      font-size: 12px;
      font-weight: 800;
      cursor: pointer;
      transition: background 140ms ease, transform 140ms ease, border-color 140ms ease, box-shadow 140ms ease;
    }

    .mconnect-copy:hover {
      background: rgba(255,255,255,0.06);
      transform: translateY(-1px);
      box-shadow: var(--mconnect-shadow-soft);
    }

    .mconnect-copy:active {
      transform: translateY(1px);
    }

    .mconnect-copy:focus-visible {
      outline: none;
      box-shadow: var(--mconnect-shadow-focus);
    }

    .mconnect-actions {
      display: flex;
      gap: 8px;
      margin-top: 2px;
    }

    .mconnect-btn {
      flex: 1;
      appearance: none;
      border: 1px solid rgba(255,255,255,0.10);
      border-radius: calc(var(--mconnect-radius) + 2px);
      padding: 10px 12px;
      font-size: 12.5px;
      font-weight: 850;
      line-height: 1;
      cursor: pointer;
      user-select: none;
      -webkit-tap-highlight-color: transparent;
      background: var(--mconnect-secondary);
      color: var(--mconnect-secondary-foreground);
      transition: transform 90ms ease, background 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
    }

    .mconnect-btn:hover {
      background: rgba(255,255,255,0.06);
      box-shadow: var(--mconnect-shadow-soft);
    }

    .mconnect-btn:active {
      transform: translateY(1px);
    }

    .mconnect-btn:focus-visible {
      outline: none;
      box-shadow: var(--mconnect-shadow-focus);
    }

    .mconnect-btn:disabled {
      opacity: 0.55;
      cursor: not-allowed;
      box-shadow: none;
    }

    .mconnect-btn-primary {
      border-color: rgba(255,255,255,0.12);
      color: var(--mconnect-primary-foreground);
      background: var(--mconnect-primary-gradient);
    }

    .mconnect-btn-primary:hover {
      background: var(--mconnect-primary-gradient-hover);
      box-shadow: var(--mconnect-shadow);
    }

    .mconnect-btn-destructive {
      border-color: rgba(255,255,255,0.10);
      background: var(--mconnect-destructive);
      color: var(--mconnect-destructive-foreground);
    }

    .mconnect-hint {
      margin-top: 2px;
      font-size: 11.5px;
      line-height: 1.35;
      opacity: 0.82;
      min-height: 16px;
    }
  `;
    const ensureDom = () => {
        if (root)
            return;
        root = document.createElement("div");
        root.className = "mconnect-overlay";
        root.tabIndex = -1;
        root.innerHTML = `
      <style>${css}</style>
      <div class="mconnect-modal" role="dialog" aria-modal="true">
        <div class="mconnect-header">
          <div class="mconnect-brand">
            <div class="mconnect-mark">D</div>
            <div class="mconnect-txt">
              <div class="mconnect-title" id="mconnectTitle">${options.appName ? `Connect ${escapeHtml(options.appName)}` : "Connect Wallet"}</div>
              <div class="mconnect-sub">This dApp will request permission to view your account and approve transactions.</div>
            </div>
          </div>
          <button class="mconnect-icon-btn" type="button" data-action="close" aria-label="Close">✕</button>
        </div>
        <div class="mconnect-body">
          <div class="mconnect-row mconnect-row-data"><div class="mconnect-lab">Status</div><div class="mconnect-val" id="dwcStatus">—</div></div>
          <div class="mconnect-row mconnect-row-data">
            <div class="mconnect-lab">Account</div>
            <div class="mconnect-val"><span id="dwcAccount">—</span><button class="mconnect-copy" id="dwcCopy" type="button" data-action="copy" hidden>Copy</button></div>
          </div>
          <div class="mconnect-row mconnect-row-data"><div class="mconnect-lab">Network</div><div class="mconnect-val" id="dwcNetwork">—</div></div>
          <div class="mconnect-actions">
            <button class="mconnect-btn mconnect-btn-primary" id="dwcPrimary" type="button" data-action="primary">—</button>
          </div>
          <div class="mconnect-hint" id="dwcHint"></div>
        </div>
      </div>
    `;
        $title = root.querySelector("#mconnectTitle");
        $status = root.querySelector("#dwcStatus");
        $account = root.querySelector("#dwcAccount");
        $network = root.querySelector("#dwcNetwork");
        $copy = root.querySelector("#dwcCopy");
        $primary = root.querySelector("#dwcPrimary");
        $hint = root.querySelector("#dwcHint");
        root.addEventListener("click", async (e) => {
            const target = e.target;
            if (!target)
                return;
            // click outside the modal closes
            if (target === root) {
                close();
                return;
            }
            const btn = target.closest("button[data-action]");
            if (!btn)
                return;
            const action = btn.getAttribute("data-action") || "";
            if (action === "close") {
                close();
                return;
            }
            const st = wallet.state;
            const status = walletStatus(st);
            if (action === "copy") {
                const acct = st.accounts?.[0] || "";
                if (!acct)
                    return;
                const ok = await copyToClipboard(acct);
                toast(ok ? "Copied" : "Copy failed");
                return;
            }
            if (action === "primary") {
                if (status === "missing") {
                    if (options.installUrl)
                        window.open(options.installUrl, "_blank", "noopener,noreferrer");
                    return;
                }
                if (status === "connected") {
                    await wallet.disconnect();
                    return;
                }
                // disconnected/locked
                await wallet.connect();
            }
        });
        unsub = wallet.subscribe((st) => update(st));
        update(wallet.state);
    };
    const onKeyDown = (e) => {
        if (e.key === "Escape")
            close();
    };
    const toast = (msg) => {
        if (!$hint)
            return;
        $hint.textContent = msg;
        // clear after a bit
        window.setTimeout(() => {
            if ($hint)
                $hint.textContent = "";
        }, 1200);
    };
    const update = (st) => {
        const status = walletStatus(st);
        const acct = st.accounts?.[0] || "";
        const net = networkLabel(st);
        if ($title) {
            const app = (options.appName || "").trim();
            $title.textContent =
                status === "connected"
                    ? app
                        ? `Connected to ${app}`
                        : "Wallet"
                    : app
                        ? `Connect ${app}`
                        : "Connect Wallet";
        }
        if ($status) {
            $status.textContent = STATUS_TEXT[status];
        }
        if ($account)
            $account.textContent = acct ? shortenMiddle(acct, 10, 8) : "—";
        if ($network)
            $network.textContent = net || "—";
        if ($copy)
            $copy.hidden = !acct;
        if ($primary) {
            $primary.classList.toggle("mconnect-btn-destructive", status === "connected");
            $primary.classList.toggle("mconnect-btn-primary", status !== "connected");
            $primary.textContent = PRIMARY_TEXT[status];
        }
        // Auto-close when we transition into connected.
        if (open && closeOnConnect && lastStatus && lastStatus !== "connected" && status === "connected") {
            close();
        }
        lastStatus = status;
    };
    const openModal = () => {
        ensureDom();
        if (!root || open)
            return;
        document.body.appendChild(root);
        open = true;
        lastStatus = walletStatus(wallet.state);
        root.focus();
        window.addEventListener("keydown", onKeyDown);
    };
    const close = () => {
        if (!root || !open)
            return;
        open = false;
        window.removeEventListener("keydown", onKeyDown);
        root.remove();
    };
    const destroy = () => {
        close();
        try {
            unsub?.();
        }
        catch {
            // ignore
        }
        unsub = null;
        root = null;
        $title = $status = $account = $network = $hint = null;
        $copy = $primary = null;
    };
    return {
        open: openModal,
        close,
        destroy,
        isOpen: () => open,
    };
}
function escapeHtml(input) {
    return String(input)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}
//# sourceMappingURL=modal.js.map