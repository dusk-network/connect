import { defineDuskConnectButton } from "../../dist/ui.js";
import { createDuskWallet } from "../../dist/index.js";

defineDuskConnectButton();

const wallet = createDuskWallet();

// Connect button (web component)
const connectBtn = document.getElementById("connectBtn");
if (connectBtn) connectBtn.wallet = wallet;

const $ = (id) => document.getElementById(id);
const elStatus = $("status");
const elAccount = $("account");
const elChainId = $("chainId");

function shorten(s, left = 10, right = 8) {
  if (!s) return "—";
  if (s.length <= left + right + 3) return s;
  return `${s.slice(0, left)}…${s.slice(-right)}`;
}

function render(st) {
  const installed = !!st.installed;
  const connected = !!st.authorized && (st.accounts?.length ?? 0) > 0;

  elStatus.textContent = !installed ? "Install Dusk Wallet" : connected ? "Connected" : "Not connected";
  elAccount.textContent = connected ? shorten(st.accounts[0]) : "—";
  elChainId.textContent = st.chainId ?? "—";
}

wallet.subscribe(render);

await wallet.ready();
// Non-interactive refresh so the UI is correct on load.
await wallet.refresh().catch(() => {});
