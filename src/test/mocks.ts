import { vi } from "vitest";

import type {
  AccountId,
  ChainId,
  DuskNodeChangedPayload,
  DuskProvider,
  DuskProviderCapabilities,
  DuskProviderEventMap,
  DuskWalletState,
} from "../types.js";

type EventName = keyof DuskProviderEventMap | (string & {});
type EventHandler = (...args: any[]) => void;
type MockResponse =
  | unknown
  | ((params: unknown, provider: MockDuskProvider) => unknown | Promise<unknown>);

export type MockDuskProvider = DuskProvider & {
  request: ReturnType<typeof vi.fn>;
  emit<E extends keyof DuskProviderEventMap>(event: E, payload: DuskProviderEventMap[E]): void;
  setAccounts(next: AccountId[]): void;
  setChainId(next: ChainId | null): void;
  setAuthorized(next: boolean): void;
  setResponse(method: string, response: MockResponse | undefined): void;
};

export function createMockProvider(
  opts: {
    accounts?: AccountId[];
    chainId?: ChainId | null;
    authorized?: boolean;
    capabilities?: Partial<DuskProviderCapabilities>;
    responses?: Record<string, MockResponse>;
  } = {}
): MockDuskProvider {
  let accounts = [...(opts.accounts ?? ["dusk1mockaccount"])];
  let chainId = opts.chainId ?? "dusk:2";
  let authorized = opts.authorized ?? false;
  const responses = new Map(Object.entries(opts.responses ?? {}));
  const handlers = new Map<EventName, Set<EventHandler>>();

  const on = vi.fn((eventName: string, handler: EventHandler) => {
    const set = handlers.get(eventName) ?? new Set<EventHandler>();
    set.add(handler);
    handlers.set(eventName, set);
  });

  const off = vi.fn((eventName: string, handler: EventHandler) => {
    handlers.get(eventName)?.delete(handler);
  });

  const once = vi.fn((eventName: string, handler: EventHandler) => {
    const wrapped = (...args: any[]) => {
      off(eventName, wrapped);
      handler(...args);
    };
    on(eventName, wrapped);
  });

  const removeAllListeners = vi.fn((eventName?: string) => {
    if (eventName) {
      handlers.delete(eventName);
      return;
    }
    handlers.clear();
  });

  const emit = (eventName: EventName, payload: unknown) => {
    const set = handlers.get(eventName);
    if (!set) return;
    for (const handler of [...set]) {
      handler(payload);
    }
  };

  const provider = {
    isDusk: true as const,
    get chainId() {
      return chainId;
    },
    get selectedAddress() {
      return accounts[0] ?? null;
    },
    get isAuthorized() {
      return authorized;
    },
    request: vi.fn(async ({ method, params }: { method: string; params?: unknown }) => {
      const custom = responses.get(method);
      if (custom !== undefined) {
        return typeof custom === "function"
          ? await custom(params, provider as MockDuskProvider)
          : custom;
      }

      switch (method) {
        case "dusk_getCapabilities":
          return {
            provider: "dusk-wallet",
            walletVersion: "0.0.0-test",
            chainId: chainId ?? "dusk:2",
            nodeUrl: "https://testnet.nodes.dusk.network",
            networkName: "Testnet",
            methods: ["dusk_requestAccounts", "dusk_accounts", "dusk_chainId"],
            txKinds: ["transfer", "contract_call"],
            limits: { maxFnArgsBytes: 65536 },
            ...opts.capabilities,
          } satisfies DuskProviderCapabilities;
        case "dusk_chainId":
          return chainId;
        case "dusk_accounts":
          return authorized ? [...accounts] : [];
        case "dusk_requestAccounts": {
          authorized = true;
          const next = [...accounts];
          emit("connect", { chainId: chainId ?? "dusk:2" });
          emit("accountsChanged", next);
          return next;
        }
        case "dusk_disconnect":
          authorized = false;
          emit("disconnect", { code: 4900 });
          emit("accountsChanged", []);
          return true;
        case "dusk_sendTransaction":
          return { hash: "0xtxhash", nonce: "7" };
        case "dusk_watchAsset":
          return true;
        default:
          throw Object.assign(new Error(`Unhandled mock request: ${method}`), { code: -32601 });
      }
    }),
    on,
    once,
    removeListener: off,
    off,
    removeAllListeners,
    enable: vi.fn(async () => {
      return await (provider as MockDuskProvider).request({ method: "dusk_requestAccounts" });
    }),
    isConnected: vi.fn(() => true),
    emit(eventName: EventName, payload: unknown) {
      emit(eventName, payload);
    },
    setAccounts(next: AccountId[]) {
      accounts = [...next];
      emit("accountsChanged", [...accounts]);
    },
    setChainId(next: ChainId | null) {
      chainId = next;
      if (typeof next === "string") emit("chainChanged", next);
    },
    setAuthorized(next: boolean) {
      authorized = next;
    },
    setResponse(method: string, response: MockResponse | undefined) {
      if (response === undefined) {
        responses.delete(method);
        return;
      }
      responses.set(method, response);
    },
  } satisfies Partial<MockDuskProvider>;

  return provider as MockDuskProvider;
}

export type MockUiWallet = {
  readonly state: DuskWalletState;
  subscribe: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  ready: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  emit(partial: Partial<DuskWalletState>): void;
};

export function createMockUiWallet(
  initial: Partial<DuskWalletState> = {}
): MockUiWallet {
  let state: DuskWalletState = {
    installed: true,
    authorized: false,
    accounts: [],
    chainId: "dusk:2",
    selectedAddress: null,
    node: null,
    capabilities: null,
    lastUpdated: Date.now(),
    ...initial,
  };

  const subs = new Set<(state: DuskWalletState) => void>();

  const snapshot = (): DuskWalletState => ({
    ...state,
    accounts: [...state.accounts],
    node: state.node ? { ...state.node } : null,
  });

  const notify = () => {
    const next = snapshot();
    for (const fn of subs) fn(next);
  };

  const wallet: MockUiWallet = {
    get state() {
      return snapshot();
    },
    subscribe: vi.fn((fn: (state: DuskWalletState) => void) => {
      subs.add(fn);
      fn(snapshot());
      return () => subs.delete(fn);
    }),
    connect: vi.fn(async () => {
      state = {
        ...state,
        authorized: true,
        accounts: state.accounts.length ? [...state.accounts] : ["dusk1connectedacct"],
        selectedAddress: state.accounts[0] ?? "dusk1connectedacct",
        lastUpdated: Date.now(),
      };
      notify();
      return [...state.accounts];
    }),
    disconnect: vi.fn(async () => {
      state = {
        ...state,
        authorized: false,
        accounts: [],
        selectedAddress: null,
        lastUpdated: Date.now(),
      };
      notify();
      return true;
    }),
    ready: vi.fn(async () => wallet as any),
    destroy: vi.fn(),
    emit(partial: Partial<DuskWalletState>) {
      state = {
        ...state,
        ...partial,
        accounts: partial.accounts ? [...partial.accounts] : [...state.accounts],
        node: partial.node === undefined ? state.node : partial.node,
        lastUpdated: Date.now(),
      };
      notify();
    },
  };

  return wallet;
}

export function makeNodeChangedPayload(
  patch: Partial<DuskNodeChangedPayload> = {}
): DuskNodeChangedPayload {
  return {
    chainId: "dusk:2",
    nodeUrl: "https://testnet.nodes.dusk.network",
    networkName: "Testnet",
    ...patch,
  };
}
