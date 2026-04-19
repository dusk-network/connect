import { defineDuskConnectButton } from "../../dist/ui.js";
import { createDuskWallet } from "../../dist/index.js";

defineDuskConnectButton();

const wallet = createDuskWallet();

// Connect button (web component)
const connectBtn = document.getElementById("connectBtn");
if (connectBtn) connectBtn.wallet = wallet;

const $ = (id) => document.getElementById(id);
const elStatus = $("status");
const elWalletCount = $("walletCount");
const elProviderName = $("providerName");
const elProviderSelect = /** @type {HTMLSelectElement | null} */ ($("providerSelect"));
const elAccount = $("account");
const elChainId = $("chainId");

function shorten(s, left = 10, right = 8) {
  if (!s) return "—";
  if (s.length <= left + right + 3) return s;
  return `${s.slice(0, left)}…${s.slice(-right)}`;
}

function render(st) {
  const installed = !!st.installed;
  const walletCount = st.availableProviders?.length ?? 0;
  const needsSelection = installed && walletCount > 1 && !st.providerId;
  const connected = !!st.authorized && (st.accounts?.length ?? 0) > 0;

  elStatus.textContent = !installed
    ? "No wallet discovered"
    : needsSelection
      ? "Choose wallet"
      : connected
        ? "Connected"
        : "Not connected";
  elWalletCount.textContent = String(walletCount);
  elProviderName.textContent = st.providerInfo?.name ?? "—";
  elAccount.textContent = connected ? shorten(st.accounts[0]) : "—";
  elChainId.textContent = st.chainId ?? "—";

  if (elProviderSelect) {
    const providers = st.availableProviders ?? [];
    const options = [
      providers.length > 1
        ? `<option value="">Choose wallet</option>`
        : `<option value="">${providers.length ? "Wallet auto-selected" : "No wallets found"}</option>`,
      ...providers.map(
        (provider) =>
          `<option value="${provider.uuid}">${provider.name} (${provider.rdns})</option>`
      ),
    ].join("");

    if (elProviderSelect.dataset.options !== options) {
      elProviderSelect.innerHTML = options;
      elProviderSelect.dataset.options = options;
    }

    elProviderSelect.value = st.providerId ?? "";
    elProviderSelect.disabled = providers.length <= 1;
  }
}

wallet.subscribe(render);

elProviderSelect?.addEventListener("change", async () => {
  const providerId = elProviderSelect.value;
  if (!providerId) return;
  await wallet.selectProvider(providerId).catch((error) => {
    console.error("provider selection failed", error);
  });
});

await wallet.ready();
// Non-interactive refresh so the UI is correct on load.
await wallet.refresh().catch(() => {});
