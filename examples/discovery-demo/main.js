import {
  DUSK_REQUEST_PROVIDER_EVENT,
  announceDuskProvider,
  createDuskWallet,
} from "../../dist/index.js";
import { defineDuskConnectButton } from "../../dist/ui.js";

defineDuskConnectButton();

function isDuskProvider(provider) {
  const name = String(provider?.name || "").trim().toLowerCase();
  const rdns = String(provider?.rdns || "").trim().toLowerCase();
  return name === "dusk wallet" || rdns === "network.dusk.wallet" || rdns.endsWith(".dusk.wallet");
}

function providerInitial(provider) {
  const initial = String(provider?.name || "Wallet").trim().charAt(0).toUpperCase();
  return /^[A-Z0-9]$/.test(initial) ? initial : "W";
}

function providerAccent(provider) {
  const rdns = String(provider?.rdns || "").toLowerCase();
  if (rdns.includes("harbor")) return "#6FBF8E";
  return "#71B1FF";
}

function providerIcon(provider) {
  const icon = document.createElement("span");
  icon.classList.add("providerIcon");
  icon.setAttribute("aria-hidden", "true");

  if (isDuskProvider(provider)) {
    icon.classList.add("providerIconDusk");
    return icon;
  }

  icon.classList.add("providerIconInitial");
  icon.style.setProperty("--provider-accent", providerAccent(provider));
  icon.textContent = providerInitial(provider);
  return icon;
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
              "dusk_requestProfiles",
              "dusk_profiles",
              "dusk_requestShieldedAddress",
              "dusk_chainId",
              "dusk_switchNetwork",
              "dusk_getPublicBalance",
              "dusk_estimateGas",
              "dusk_sendTransaction",
              "dusk_watchAsset",
              "dusk_signMessage",
              "dusk_signAuth",
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
              shieldedReceiveAddress: true,
              signMessage: true,
              signAuth: true,
              contractCallPrivacy: true,
              watchAsset: true,
            },
          };

        case "dusk_profiles":
          return authorized ? [{ profileId: "profile:0", account }] : [];

        case "dusk_requestProfiles":
          authorized = true;
          emit("connect", { chainId });
          const profiles = [
            {
              profileId: "profile:0",
              account,
              ...(params?.shieldedReceiveAddress
                ? { shieldedAddress: "dusk1demoshieldedreceiveaddress111111111111111111111111111" }
                : {}),
            },
          ];
          emit("profilesChanged", profiles);
          return profiles;

        case "dusk_requestShieldedAddress":
          return {
            address: "dusk1demoshieldedreceiveaddress111111111111111111111111111",
            profileId: "profile:0",
            account,
            chainId,
          };

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
          emit("profilesChanged", []);
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
    isConnected() {
      return true;
    },
    get chainId() {
      return chainId;
    },
    get profiles() {
      return authorized ? [{ profileId: "profile:0", account }] : [];
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
    icon: "",
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
    icon: "",
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
  elProviderList.replaceChildren();

  if (!providers.length) {
    const card = document.createElement("div");
    card.className = "providerCard";

    const copy = document.createElement("div");
    copy.className = "providerCopy";

    const name = document.createElement("div");
    name.className = "providerName";
    name.textContent = "No wallets discovered";

    const meta = document.createElement("div");
    meta.className = "providerMeta";
    meta.textContent = "Dispatch `dusk:requestProvider` to ask wallets to announce again.";

    copy.append(name, meta);
    card.append(copy);
    elProviderList.append(card);
    return;
  }

  for (const provider of providers) {
    const card = document.createElement("article");
    card.className = "providerCard";
    card.dataset.selected = provider.uuid === state.providerId ? "true" : "false";

    const main = document.createElement("div");
    main.className = "providerMain";

    const copy = document.createElement("div");
    copy.className = "providerCopy";

    const name = document.createElement("div");
    name.className = "providerName";
    name.textContent = provider.name;

    const uuid = document.createElement("div");
    uuid.className = "providerMeta mono";
    uuid.textContent = provider.uuid;

    const rdns = document.createElement("div");
    rdns.className = "providerMeta";
    rdns.textContent = provider.rdns;

    const button = document.createElement("button");
    button.className = "providerUse";
    button.type = "button";
    button.dataset.providerId = provider.uuid;
    button.textContent = provider.uuid === state.providerId ? "Selected" : "Use Wallet";

    copy.append(name, uuid, rdns);
    main.append(providerIcon(provider), copy);
    card.append(main, button);
    elProviderList.append(card);
  }
}

function render(state) {
  const installed = !!state.installed;
  const needsSelection = installed && (state.availableProviders?.length ?? 0) > 1 && !state.providerId;
  const connected = !!state.authorized && (state.profiles?.length ?? 0) > 0;

  elStatus.textContent = !installed
    ? "No wallets discovered"
    : needsSelection
      ? "Choose wallet"
      : connected
        ? "Connected"
        : "Wallet selected";
  elSelectedWallet.textContent = state.providerInfo?.name ?? "—";
  elProviderId.textContent = state.providerId ?? "—";
  elAccount.textContent = connected ? shorten(state.selectedProfile?.account || state.profiles[0]?.account) : "—";
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
    const profiles = await wallet.connect();
    log(`connected ${profiles[0]?.account ?? "unknown profile"}`);
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
