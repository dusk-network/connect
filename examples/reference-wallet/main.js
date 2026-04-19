import { createDuskWallet } from "../../dist/index.js";

const DUSK_REQUEST_PROVIDER_EVENT = "dusk:requestProvider";
const DUSK_ANNOUNCE_PROVIDER_EVENT = "dusk:announceProvider";

function svgIcon() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
      <defs>
        <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
          <stop stop-color="#9bf0c3" />
          <stop offset="1" stop-color="#73ccff" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill="#09131d" />
      <rect x="8" y="8" width="48" height="48" rx="14" fill="url(#g)" />
      <text x="50%" y="53%" dominant-baseline="middle" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="#092132">DW</text>
    </svg>
  `;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function hexOf(value) {
  return `0x${[...new TextEncoder().encode(String(value || ""))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function createReferenceWallet() {
  const info = {
    uuid: "dev.reference.wallet",
    name: "Reference Wallet",
    icon: svgIcon(),
    rdns: "dev.reference.wallet",
  };

  const listeners = new Map();
  const accounts = [
    "dusk1referenceaccount1111111111111111111111111111111",
    "dusk1secondreferenceaccount11111111111111111111111111",
  ];

  let authorized = false;
  let accountIndex = 0;
  let chainId = "dusk:2";
  let networkName = "Testnet";
  let nodeUrl = "https://testnet.nodes.dusk.network";
  let balance = { nonce: "7", value: "12500000000" };
  let txCounter = 0;

  const emit = (eventName, payload) => {
    const set = listeners.get(eventName);
    if (!set) return;
    for (const handler of [...set]) handler(payload);
  };

  const on = (eventName, handler) => {
    const set = listeners.get(eventName) ?? new Set();
    set.add(handler);
    listeners.set(eventName, set);
  };

  const off = (eventName, handler) => {
    listeners.get(eventName)?.delete(handler);
  };

  const announce = () => {
    window.dispatchEvent(
      new CustomEvent(DUSK_ANNOUNCE_PROVIDER_EVENT, {
        detail: { info, provider },
      })
    );
    log("wallet announced itself");
  };

  const requireAuthorized = () => {
    if (authorized) return;
    throw Object.assign(new Error("Origin is not connected"), { code: 4100 });
  };

  const provider = {
    isDusk: true,
    get chainId() {
      return chainId;
    },
    get selectedAddress() {
      return authorized ? accounts[accountIndex] : null;
    },
    get isAuthorized() {
      return authorized;
    },
    async request({ method, params }) {
      switch (method) {
        case "dusk_getCapabilities":
          return {
            provider: info.rdns,
            walletVersion: "0.0.0-reference",
            chainId,
            nodeUrl,
            networkName,
            methods: [
              "dusk_getCapabilities",
              "dusk_requestAccounts",
              "dusk_accounts",
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
              signMessage: true,
              signAuth: true,
              contractCallPrivacy: true,
              watchAsset: true,
            },
          };

        case "dusk_requestAccounts":
          authorized = true;
          emit("connect", { chainId });
          emit("accountsChanged", [accounts[accountIndex]]);
          renderWalletPanel();
          log("wallet approved connection");
          return [accounts[accountIndex]];

        case "dusk_accounts":
          return authorized ? [accounts[accountIndex]] : [];

        case "dusk_chainId":
          return chainId;

        case "dusk_switchNetwork": {
          requireAuthorized();
          const next = Array.isArray(params) ? params[0] : params;
          const nextChainId = next?.chainId === "dusk:3" ? "dusk:3" : "dusk:2";
          chainId = nextChainId;
          networkName = chainId === "dusk:3" ? "Devnet" : "Testnet";
          nodeUrl =
            chainId === "dusk:3"
              ? "https://devnet.nodes.dusk.network"
              : "https://testnet.nodes.dusk.network";
          emit("chainChanged", chainId);
          emit("duskNodeChanged", { chainId, nodeUrl, networkName });
          renderWalletPanel();
          log(`wallet switched network -> ${chainId}`);
          return null;
        }

        case "dusk_getPublicBalance":
          requireAuthorized();
          return { ...balance };

        case "dusk_estimateGas":
          requireAuthorized();
          return { average: "1", max: "2", median: "1", min: "1" };

        case "dusk_sendTransaction":
          requireAuthorized();
          txCounter += 1;
          return { hash: `0xreference${String(txCounter).padStart(4, "0")}`, nonce: String(200 + txCounter) };

        case "dusk_watchAsset":
          requireAuthorized();
          return true;

        case "dusk_signMessage":
          requireAuthorized();
          return {
            account: accounts[accountIndex],
            origin: window.location.origin,
            chainId,
            messageHash: hexOf("message-hash"),
            messageLen: String(params?.message ?? "").length,
            signature: hexOf("message-signature"),
            payload: hexOf(params?.message ?? ""),
          };

        case "dusk_signAuth":
          requireAuthorized();
          return {
            account: accounts[accountIndex],
            origin: window.location.origin,
            chainId,
            nonce: String(params?.nonce ?? "nonce"),
            issuedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
            message: "Reference auth payload",
            signature: hexOf("auth-signature"),
            payload: hexOf("Reference auth payload"),
          };

        case "dusk_disconnect":
          authorized = false;
          emit("disconnect", { code: 4900, message: "Disconnected" });
          emit("accountsChanged", []);
          renderWalletPanel();
          log("wallet disconnected");
          return true;

        default:
          throw Object.assign(new Error(`Unsupported method: ${method}`), { code: 4200 });
      }
    },
    on,
    once(eventName, handler) {
      const wrapped = (payload) => {
        off(eventName, wrapped);
        handler(payload);
      };
      on(eventName, wrapped);
    },
    off,
    removeListener: off,
    removeAllListeners(eventName) {
      if (eventName) listeners.delete(eventName);
      else listeners.clear();
    },
    enable() {
      return this.request({ method: "dusk_requestAccounts" });
    },
    isConnected() {
      return true;
    },
  };

  window.addEventListener(DUSK_REQUEST_PROVIDER_EVENT, announce);

  return {
    info,
    provider,
    announce,
    rotateAccount() {
      accountIndex = accountIndex === 0 ? 1 : 0;
      if (authorized) emit("accountsChanged", [accounts[accountIndex]]);
      renderWalletPanel();
      log(`wallet rotated account -> ${accounts[accountIndex]}`);
    },
    switchChain() {
      chainId = chainId === "dusk:2" ? "dusk:3" : "dusk:2";
      networkName = chainId === "dusk:3" ? "Devnet" : "Testnet";
      nodeUrl =
        chainId === "dusk:3"
          ? "https://devnet.nodes.dusk.network"
          : "https://testnet.nodes.dusk.network";
      if (authorized) {
        emit("chainChanged", chainId);
        emit("duskNodeChanged", { chainId, nodeUrl, networkName });
      }
      renderWalletPanel();
      log(`wallet switched chain locally -> ${chainId}`);
    },
    disconnect() {
      authorized = false;
      emit("disconnect", { code: 4900, message: "Disconnected" });
      emit("accountsChanged", []);
      renderWalletPanel();
      log("wallet forced a disconnect");
    },
    snapshot() {
      return {
        authorized,
        account: authorized ? accounts[accountIndex] : null,
        chainId,
      };
    },
  };
}

const $ = (id) => document.getElementById(id);
const elWalletName = $("walletName");
const elWalletUuid = $("walletUuid");
const elWalletRdns = $("walletRdns");
const elWalletAuthorized = $("walletAuthorized");
const elWalletAccount = $("walletAccount");
const elWalletChain = $("walletChain");
const elSdkStatus = $("sdkStatus");
const elSdkProvider = $("sdkProvider");
const elSdkAccount = $("sdkAccount");
const elSdkChain = $("sdkChain");
const elSdkBalance = $("sdkBalance");
const elProviderSummary = $("providerSummary");
const elLog = $("log");

function log(line) {
  const stamp = new Date().toLocaleTimeString();
  elLog.textContent = `[${stamp}] ${line}\n${elLog.textContent}`;
}

const fixture = createReferenceWallet();

function renderWalletPanel() {
  const state = fixture.snapshot();
  elWalletName.textContent = fixture.info.name;
  elWalletUuid.textContent = fixture.info.uuid;
  elWalletRdns.textContent = fixture.info.rdns;
  elWalletAuthorized.textContent = state.authorized ? "Yes" : "No";
  elWalletAccount.textContent = state.account ?? "-";
  elWalletChain.textContent = state.chainId;
}

const wallet = createDuskWallet({
  preferredProviderId: fixture.info.uuid,
});

wallet.on("accountsChanged", (accounts) => {
  log(`dapp observed accountsChanged -> ${accounts.join(", ") || "[]"}`);
});

wallet.on("chainChanged", (chainId) => {
  log(`dapp observed chainChanged -> ${chainId}`);
});

wallet.on("duskNodeChanged", (payload) => {
  log(`dapp observed duskNodeChanged -> ${payload.networkName} (${payload.nodeUrl})`);
});

function renderSdkPanel(state) {
  elSdkStatus.textContent = !state.installed
    ? "No provider discovered"
    : state.authorized
      ? "Connected"
      : state.providerId
        ? "Discovered"
        : "Choose provider";
  elSdkProvider.textContent = state.providerId ?? "-";
  elSdkAccount.textContent = state.accounts[0] ?? "-";
  elSdkChain.textContent = state.chainId ?? "-";
  elProviderSummary.textContent = state.availableProviders.length
    ? `${state.availableProviders[0].name} | ${state.availableProviders[0].uuid} | ${state.availableProviders[0].rdns}`
    : "-";
}

wallet.subscribe((state) => {
  renderSdkPanel(state);
});

renderWalletPanel();
fixture.announce();
await wallet.ready();
renderSdkPanel(wallet.state);

$("btnAnnounce").addEventListener("click", () => {
  fixture.announce();
});

$("btnRotateAccount").addEventListener("click", () => {
  fixture.rotateAccount();
});

$("btnSwitchChain").addEventListener("click", () => {
  fixture.switchChain();
});

$("btnDisconnectWallet").addEventListener("click", () => {
  fixture.disconnect();
});

$("btnDiscover").addEventListener("click", async () => {
  await wallet.refresh();
  log("dapp requested rediscovery");
});

$("btnConnect").addEventListener("click", async () => {
  const accounts = await wallet.connect();
  log(`dapp connected -> ${accounts.join(", ")}`);
});

$("btnBalance").addEventListener("click", async () => {
  const balance = await wallet.getPublicBalance();
  elSdkBalance.textContent = `${balance.value} Lux`;
  log(`dapp read balance -> ${balance.value} Lux`);
});

$("btnDisconnect").addEventListener("click", async () => {
  await wallet.disconnect();
  log("dapp disconnected");
});
