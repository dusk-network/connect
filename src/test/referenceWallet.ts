import {
  DUSK_ANNOUNCE_PROVIDER_EVENT,
  DUSK_REQUEST_PROVIDER_EVENT,
  normalizeDuskProviderInfo,
} from "../discovery.js";

import type {
  AccountId,
  BalanceResult,
  ChainId,
  DuskNodeChangedPayload,
  DuskProvider,
  DuskProviderCapabilities,
  DuskProviderEventMap,
  DuskProviderInfo,
  GasPriceResult,
  SignAuthParams,
  SignAuthResult,
  SignMessageResult,
} from "../types.js";

type EventName = keyof DuskProviderEventMap | (string & {});
type EventHandler = (...args: any[]) => void;

const DEFAULT_INFO: DuskProviderInfo = {
  uuid: "dev.reference.wallet",
  name: "Reference Wallet",
  icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E",
  rdns: "dev.reference.wallet",
};

const DEFAULT_BALANCE: BalanceResult = {
  nonce: "7",
  value: "12500000000",
};

const DEFAULT_GAS: GasPriceResult = {
  average: "1",
  max: "2",
  median: "1",
  min: "1",
};

const PRESET_NETWORKS: Record<string, { nodeUrl: string; networkName: string }> = {
  "dusk:0": {
    nodeUrl: "http://localhost:8080",
    networkName: "Local",
  },
  "dusk:1": {
    nodeUrl: "https://nodes.dusk.network",
    networkName: "Mainnet",
  },
  "dusk:2": {
    nodeUrl: "https://testnet.nodes.dusk.network",
    networkName: "Testnet",
  },
  "dusk:3": {
    nodeUrl: "https://devnet.nodes.dusk.network",
    networkName: "Devnet",
  },
};

function hexOf(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let out = "0x";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

function isoNowPlus(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

export type ReferenceWalletProvider = DuskProvider & {
  emit<E extends keyof DuskProviderEventMap>(eventName: E, payload: DuskProviderEventMap[E]): void;
  setAccounts(next: AccountId[]): void;
  setAuthorized(next: boolean): void;
  setNetwork(next: DuskNodeChangedPayload): void;
  setBalance(next: BalanceResult): void;
  revokePermissions(): void;
};

export type InstallReferenceWalletOptions = {
  info?: Partial<DuskProviderInfo>;
  accounts?: AccountId[];
  chainId?: ChainId;
  nodeUrl?: string;
  networkName?: string;
  balance?: BalanceResult;
  gas?: GasPriceResult;
  announceOnStart?: boolean;
  unsupportedMethods?: string[];
  requestOverrides?: Partial<Record<string, ReferenceWalletRequestOverride>>;
  target?: Window;
};

export type ReferenceWalletRequestContext = {
  info: DuskProviderInfo;
  method: string;
  params: unknown;
  accounts: AccountId[];
  authorized: boolean;
  node: DuskNodeChangedPayload;
  capabilities: DuskProviderCapabilities;
};

export type ReferenceWalletRequestOverride = (
  context: ReferenceWalletRequestContext
) => unknown | Promise<unknown>;

export type ReferenceWalletFixture = {
  info: DuskProviderInfo;
  provider: ReferenceWalletProvider;
  announce(): void;
  cleanup(): void;
};

export function installReferenceWallet(
  options: InstallReferenceWalletOptions = {}
): ReferenceWalletFixture {
  const target = options.target ?? window;
  const info = normalizeDuskProviderInfo({
    ...DEFAULT_INFO,
    ...options.info,
  });

  let accounts = [...(options.accounts ?? ["dusk1referenceaccount1111111111111111111111111111111"])];
  let authorized = false;
  let balance = { ...DEFAULT_BALANCE, ...(options.balance ?? {}) };
  let gas = { ...DEFAULT_GAS, ...(options.gas ?? {}) };
  const unsupportedMethods = new Set(options.unsupportedMethods ?? []);

  const preset = PRESET_NETWORKS[options.chainId ?? "dusk:2"] ?? PRESET_NETWORKS["dusk:2"];
  let node: DuskNodeChangedPayload = {
    chainId: options.chainId ?? "dusk:2",
    nodeUrl: options.nodeUrl ?? preset.nodeUrl,
    networkName: options.networkName ?? preset.networkName,
  };

  const listeners = new Map<EventName, Set<EventHandler>>();
  let txCounter = 0;

  const on = (eventName: EventName, handler: EventHandler) => {
    const set = listeners.get(eventName) ?? new Set<EventHandler>();
    set.add(handler);
    listeners.set(eventName, set);
  };

  const off = (eventName: EventName, handler: EventHandler) => {
    listeners.get(eventName)?.delete(handler);
  };

  const once = (eventName: EventName, handler: EventHandler) => {
    const wrapped = (...args: any[]) => {
      off(eventName, wrapped);
      handler(...args);
    };
    on(eventName, wrapped);
  };

  const emit = (eventName: EventName, payload: unknown) => {
    const set = listeners.get(eventName);
    if (!set) return;
    for (const handler of [...set]) handler(payload);
  };

  const capabilities = (): DuskProviderCapabilities => ({
    provider: info.rdns,
    walletVersion: "0.0.0-reference",
    chainId: node.chainId,
    nodeUrl: node.nodeUrl,
    networkName: node.networkName,
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
    ].filter((method) => !unsupportedMethods.has(method)),
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
  });

  const requireAuthorized = () => {
    if (authorized) return;
    throw Object.assign(new Error("Origin is not connected"), { code: 4100 });
  };

  const provider = {
    isDusk: true as const,
    get chainId() {
      return node.chainId;
    },
    get selectedAddress() {
      return authorized ? (accounts[0] ?? null) : null;
    },
    get isAuthorized() {
      return authorized;
    },
    async request({ method, params }: { method: string; params?: unknown }) {
      const override = options.requestOverrides?.[method];
      if (override) {
        return await override({
          info: { ...info },
          method,
          params,
          accounts: [...accounts],
          authorized,
          node: { ...node },
          capabilities: capabilities(),
        });
      }

      if (unsupportedMethods.has(method)) {
        throw Object.assign(new Error(`Unsupported method: ${method}`), { code: 4200 });
      }

      switch (method) {
        case "dusk_getCapabilities":
          return capabilities();

        case "dusk_accounts":
          return authorized ? [...accounts] : [];

        case "dusk_requestAccounts":
          authorized = true;
          emit("connect", { chainId: node.chainId });
          emit("accountsChanged", [...accounts]);
          return [...accounts];

        case "dusk_chainId":
          return node.chainId;

        case "dusk_switchNetwork": {
          requireAuthorized();
          const next = Array.isArray(params) ? params[0] : params;
          const nextObj = next && typeof next === "object" ? (next as { chainId?: string; nodeUrl?: string }) : null;
          if (!nextObj || (!nextObj.chainId && !nextObj.nodeUrl)) {
            throw Object.assign(new Error("Expected chainId or nodeUrl"), { code: 4200 });
          }

          const nextChainId = typeof nextObj.chainId === "string" && nextObj.chainId.trim()
            ? nextObj.chainId.trim()
            : node.chainId;
          const presetNext = PRESET_NETWORKS[nextChainId];
          const nextNodeUrl = typeof nextObj.nodeUrl === "string" && nextObj.nodeUrl.trim()
            ? nextObj.nodeUrl.trim()
            : (presetNext?.nodeUrl ?? node.nodeUrl);
          const nextNetworkName = presetNext?.networkName ?? (nextNodeUrl === node.nodeUrl ? node.networkName : "Custom");

          node = {
            chainId: nextChainId,
            nodeUrl: nextNodeUrl,
            networkName: nextNetworkName,
          };

          emit("chainChanged", node.chainId);
          emit("duskNodeChanged", { ...node });
          return null;
        }

        case "dusk_getPublicBalance":
          requireAuthorized();
          return { ...balance };

        case "dusk_estimateGas":
          requireAuthorized();
          return { ...gas };

        case "dusk_sendTransaction":
          requireAuthorized();
          txCounter += 1;
          return {
            hash: `0xreference${String(txCounter).padStart(4, "0")}`,
            nonce: String(100 + txCounter),
          };

        case "dusk_watchAsset":
          requireAuthorized();
          return true;

        case "dusk_signMessage": {
          requireAuthorized();
          const next = Array.isArray(params) ? params[0] : params;
          const message =
            next && typeof next === "object" && "message" in next ? String((next as { message?: unknown }).message ?? "") : "";
          const account = accounts[0] ?? "dusk1referenceaccount1111111111111111111111111111111";
          const origin = target.location?.origin || "http://localhost";
          const payload = hexOf(message);
          const result: SignMessageResult = {
            account,
            origin,
            chainId: node.chainId,
            messageHash: hexOf(`hash:${message}`),
            messageLen: message.length,
            signature: hexOf(`sig:${message}`),
            payload,
          };
          return result;
        }

        case "dusk_signAuth": {
          requireAuthorized();
          const next = (Array.isArray(params) ? params[0] : params) as SignAuthParams | undefined;
          const account = accounts[0] ?? "dusk1referenceaccount1111111111111111111111111111111";
          const origin = target.location?.origin || "http://localhost";
          const nonce = String(next?.nonce ?? "nonce");
          const issuedAt = new Date().toISOString();
          const expiresAt = next?.expiresAt ?? isoNowPlus(10);
          const statement = next?.statement ? `${next.statement}\n` : "";
          const message =
            `${statement}URI: ${origin}\nChain ID: ${node.chainId}\nNonce: ${nonce}\nIssued At: ${issuedAt}\nExpires At: ${expiresAt}`;
          const result: SignAuthResult = {
            account,
            origin,
            chainId: node.chainId,
            nonce,
            issuedAt,
            expiresAt,
            message,
            signature: hexOf(`auth:${message}`),
            payload: hexOf(message),
          };
          return result;
        }

        case "dusk_disconnect":
          authorized = false;
          emit("disconnect", { code: 4900, message: "Disconnected" });
          emit("accountsChanged", []);
          return true;

        default:
          throw Object.assign(new Error(`Unsupported method: ${method}`), { code: 4200 });
      }
    },
    on,
    once,
    off,
    removeListener: off,
    removeAllListeners(eventName?: string) {
      if (typeof eventName === "string") {
        listeners.delete(eventName);
        return;
      }
      listeners.clear();
    },
    enable() {
      return this.request({ method: "dusk_requestAccounts" });
    },
    isConnected() {
      return true;
    },
    emit(eventName: EventName, payload: unknown) {
      emit(eventName, payload);
    },
    setAccounts(next: AccountId[]) {
      accounts = [...next];
      emit("accountsChanged", authorized ? [...accounts] : []);
    },
    setAuthorized(next: boolean) {
      authorized = next;
    },
    setNetwork(next: DuskNodeChangedPayload) {
      node = { ...next };
      emit("chainChanged", node.chainId);
      emit("duskNodeChanged", { ...node });
    },
    setBalance(next: BalanceResult) {
      balance = { ...next };
    },
    revokePermissions() {
      authorized = false;
      emit("accountsChanged", []);
    },
  } satisfies Partial<ReferenceWalletProvider>;

  const announce = () => {
    target.dispatchEvent(
      new CustomEvent(DUSK_ANNOUNCE_PROVIDER_EVENT, {
        detail: {
          info,
          provider,
        },
      })
    );
  };

  const onRequest = () => announce();

  target.addEventListener(DUSK_REQUEST_PROVIDER_EVENT, onRequest);
  if (options.announceOnStart !== false) announce();

  return {
    info,
    provider: provider as ReferenceWalletProvider,
    announce,
    cleanup() {
      target.removeEventListener(DUSK_REQUEST_PROVIDER_EVENT, onRequest);
      provider.removeAllListeners();
    },
  };
}
