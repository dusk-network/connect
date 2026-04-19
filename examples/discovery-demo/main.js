import {
  DUSK_REQUEST_PROVIDER_EVENT,
  announceDuskProvider,
  createDuskWallet,
} from "../../dist/index.js";
import { defineDuskConnectButton } from "../../dist/ui.js";

defineDuskConnectButton();

function svgIcon(letter, colorA, colorB) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
      <defs>
        <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
          <stop stop-color="${colorA}" />
          <stop offset="1" stop-color="${colorB}" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill="#07111d" />
      <rect x="8" y="8" width="48" height="48" rx="14" fill="url(#g)" />
      <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-family="Arial, sans-serif" font-size="26" font-weight="700" fill="#07111d">${letter}</text>
    </svg>
  `;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function createMockProvider({ info, account, chainId, networkName, balance }) {
  let authorized = false;
  const listeners = new Map();

  const emit = (eventName, payload) => {
    const set = listeners.get(eventName);
    if (!set) return;
    for (const handler of [...set]) {
      handler(payload);
    }
  };

  const on = (eventName, handler) => {
    const set = listeners.get(eventName) ?? new Set();
    set.add(handler);
    listeners.set(eventName, set);
  };

  const off = (eventName, handler) => {
    listeners.get(eventName)?.delete(handler);
  };

  const once = (eventName, handler) => {
    const wrapped = (payload) => {
      off(eventName, wrapped);
      handler(payload);
    };
    on(eventName, wrapped);
  };

  const provider = {
    isDusk: true,
    async request({ method, params }) {
      switch (method) {
        case "dusk_getCapabilities":
          return {
            provider: info.rdns,
            walletVersion: "0.0.0-demo",
            chainId,
            nodeUrl: `https://${networkName.toLowerCase()}.nodes.dusk.network`,
            networkName,
            methods: [
              "dusk_getCapabilities",
              "dusk_requestAccounts",
              "dusk_accounts",
              "dusk_chainId",
              "dusk_getPublicBalance",
              "dusk_disconnect",
            ],
            txKinds: ["transfer", "contract_call"],
            limits: {
              maxFnArgsBytes: 65536,
              maxFnNameChars: 64,
              maxMemoBytes: 512,
            },
            features: {
              shieldedRead: false,
              shieldedRecipients: true,
              signMessage: true,
              signAuth: true,
              contractCallPrivacy: true,
              watchAsset: true,
            },
          };

        case "dusk_requestAccounts":
          authorized = true;
          emit("connect", { chainId });
          emit("accountsChanged", [account]);
          return [account];

        case "dusk_accounts":
          return authorized ? [account] : [];

        case "dusk_chainId":
          return chainId;

        case "dusk_getPublicBalance":
          if (!authorized) {
            throw Object.assign(new Error("wallet not connected"), { code: 4100 });
          }
          return { nonce: "7", value: balance };

        case "dusk_disconnect":
          authorized = false;
          emit("disconnect", { code: 4900, message: "Disconnected" });
          emit("accountsChanged", []);
          return true;

        case "dusk_switchNetwork": {
          const next = Array.isArray(params) ? params[0] : params;
          if (next?.chainId) {
            chainId = String(next.chainId);
            emit("chainChanged", chainId);
            emit("duskNodeChanged", {
              chainId,
              nodeUrl: `https://${networkName.toLowerCase()}.nodes.dusk.network`,
              networkName,
            });
          }
          return null;
        }

        default:
          throw Object.assign(new Error(`Unsupported method: ${method}`), { code: 4200 });
      }
    },
    on,
    once,
    off,
    removeListener: off,
    removeAllListeners(eventName) {
      if (typeof eventName === "string") {
        listeners.delete(eventName);
        return;
      }
      listeners.clear();
    },
    enable() {
      return provider.request({ method: "dusk_requestAccounts" });
    },
    isConnected() {
      return true;
    },
    get chainId() {
      return chainId;
    },
    get selectedAddress() {
      return authorized ? account : null;
    },
    get isAuthorized() {
      return authorized;
    },
  };

  const announce = () => announceDuskProvider({ info, provider });
  window.addEventListener(DUSK_REQUEST_PROVIDER_EVENT, announce);
  announce();
}

createMockProvider({
  info: {
    uuid: "demo.aurora.wallet",
    name: "Aurora Wallet",
    icon: svgIcon("A", "#7aa2ff", "#6fd2ff"),
    rdns: "demo.aurora.wallet",
  },
  account: "dusk1aurora9k4m7z5a6k9x4d3c2b1v8f7n6m5q4p3",
  chainId: "dusk:2",
  networkName: "Testnet",
  balance: "12500000000",
});

createMockProvider({
  info: {
    uuid: "demo.harbor.wallet",
    name: "Harbor Wallet",
    icon: svgIcon("H", "#9bf0c3", "#6fd2ff"),
    rdns: "demo.harbor.wallet",
  },
  account: "dusk1harbor7m4w8y2n5r6s9t1u3v5x7z2b4c6d8e0",
  chainId: "dusk:3",
  networkName: "Devnet",
  balance: "4200000000",
});

const wallet = createDuskWallet();
const connectBtn = document.getElementById("connectBtn");
if (connectBtn) connectBtn.wallet = wallet;

const $ = (id) => document.getElementById(id);
const elProviderList = $("providerList");
const elStatus = $("status");
const elSelectedWallet = $("selectedWallet");
const elProviderId = $("providerId");
const elAccount = $("account");
const elChainId = $("chainId");
const elBalance = $("balance");
const elLog = $("log");

const btnDiscover = /** @type {HTMLButtonElement} */ ($("btnDiscover"));
const btnConnect = /** @type {HTMLButtonElement} */ ($("btnConnect"));
const btnDisconnect = /** @type {HTMLButtonElement} */ ($("btnDisconnect"));
const btnBalance = /** @type {HTMLButtonElement} */ ($("btnBalance"));

function shorten(value, left = 8, right = 6) {
  if (!value) return "—";
  if (value.length <= left + right + 3) return value;
  return `${value.slice(0, left)}…${value.slice(-right)}`;
}

function log(line) {
  const stamp = new Date().toLocaleTimeString();
  elLog.textContent = `[${stamp}] ${line}\n${elLog.textContent}`;
}

function renderProviders(state) {
  const providers = state.availableProviders ?? [];
  if (!providers.length) {
    elProviderList.innerHTML = `<div class="providerCard"><div class="providerCopy"><div class="providerName">No wallets discovered</div><div class="providerMeta">Dispatch \`dusk:requestProvider\` to ask wallets to announce again.</div></div></div>`;
    return;
  }

  elProviderList.innerHTML = providers
    .map(
      (provider) => `
        <article class="providerCard" data-selected="${provider.uuid === state.providerId}">
          <div class="providerMain">
            <img class="providerIcon" src="${provider.icon}" alt="" />
            <div class="providerCopy">
              <div class="providerName">${provider.name}</div>
              <div class="providerMeta mono">${provider.uuid}</div>
              <div class="providerMeta">${provider.rdns}</div>
            </div>
          </div>
          <button class="providerUse" type="button" data-provider-id="${provider.uuid}">
            ${provider.uuid === state.providerId ? "Selected" : "Use Wallet"}
          </button>
        </article>
      `
    )
    .join("");
}

function render(state) {
  const installed = !!state.installed;
  const needsSelection = installed && (state.availableProviders?.length ?? 0) > 1 && !state.providerId;
  const connected = !!state.authorized && (state.accounts?.length ?? 0) > 0;

  elStatus.textContent = !installed
    ? "No wallets discovered"
    : needsSelection
      ? "Choose wallet"
      : connected
        ? "Connected"
        : "Wallet selected";
  elSelectedWallet.textContent = state.providerInfo?.name ?? "—";
  elProviderId.textContent = state.providerId ?? "—";
  elAccount.textContent = connected ? shorten(state.accounts[0]) : "—";
  elChainId.textContent = state.chainId ?? "—";
  renderProviders(state);
}

wallet.subscribe((state) => {
  render(state);
  log(
    `state -> installed=${state.installed} providers=${state.availableProviders.length} selected=${state.providerId ?? "none"} authorized=${state.authorized}`
  );
});

elProviderList.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-provider-id]");
  if (!target) return;
  const providerId = target.getAttribute("data-provider-id");
  if (!providerId) return;
  await wallet.selectProvider(providerId);
  log(`selected provider ${providerId}`);
});

btnDiscover.addEventListener("click", async () => {
  await wallet.discoverProviders();
  log("rediscovery requested");
});

btnConnect.addEventListener("click", async () => {
  try {
    const accounts = await wallet.connect();
    log(`connected ${accounts[0] ?? "unknown account"}`);
  } catch (error) {
    log(`connect failed: ${error instanceof Error ? error.message : String(error)}`);
  }
});

btnDisconnect.addEventListener("click", async () => {
  try {
    await wallet.disconnect();
    elBalance.textContent = "—";
    log("disconnected");
  } catch (error) {
    log(`disconnect failed: ${error instanceof Error ? error.message : String(error)}`);
  }
});

btnBalance.addEventListener("click", async () => {
  try {
    const balance = await wallet.getPublicBalance();
    elBalance.textContent = balance.value;
    log(`balance -> ${balance.value}`);
  } catch (error) {
    log(`balance failed: ${error instanceof Error ? error.message : String(error)}`);
  }
});

await wallet.ready();
render(wallet.state);
log("demo initialized");
