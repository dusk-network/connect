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

function renderProviderOptions(select, providers, selectedProviderId) {
  const optionsKey = JSON.stringify(
    providers.map((provider) => [provider.uuid, provider.name, provider.rdns])
  );
  if (select.dataset.options !== optionsKey) {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent =
      providers.length > 1
        ? "Choose wallet"
        : providers.length
          ? "Wallet auto-selected"
          : "No wallets found";

    const options = providers.map((provider) => {
      const option = document.createElement("option");
      option.value = provider.uuid;
      option.textContent = `${provider.name} (${provider.rdns})`;
      return option;
    });

    select.replaceChildren(placeholder, ...options);
    select.dataset.options = optionsKey;
  }

  select.value = selectedProviderId ?? "";
  select.disabled = providers.length <= 1;
}

function render(st) {
  const installed = !!st.installed;
  const walletCount = st.availableProviders?.length ?? 0;
  const needsSelection = installed && walletCount > 1 && !st.providerId;
  const connected = !!st.authorized && (st.profiles?.length ?? 0) > 0;

  elStatus.textContent = !installed
    ? "No wallet discovered"
    : needsSelection
      ? "Choose wallet"
      : connected
        ? "Connected"
        : "Not connected";
  elWalletCount.textContent = String(walletCount);
  elProviderName.textContent = st.providerInfo?.name ?? "—";
  elAccount.textContent = connected ? shorten(st.selectedProfile?.account || st.profiles[0]?.account) : "—";
  elChainId.textContent = st.chainId ?? "—";

  if (elProviderSelect) {
    const providers = st.availableProviders ?? [];
    renderProviderOptions(elProviderSelect, providers, st.providerId);
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
