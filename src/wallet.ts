import type {
  AccountId,
  Address,
  BalanceResult,
  ChainId,
  DuskProvider,
  DuskProviderEventMap,
  DuskWalletState,
  GasPriceResult,
  SendTransactionParams,
  ShieldedBalance,
  ShieldedCheckpoint,
  ShieldedStatus,
  ShieldedSyncResult,
  SwitchChainParams,
  TxResult,
} from "./types.js";

import {
  DuskWalletNotInstalledError,
  DuskWalletDisconnectedError,
  DuskWalletUnauthorizedError,
  DuskWalletUserRejectedError,
  ERROR_CODES,
  normalizeError,
  type RpcErrorLike,
} from "./errors.js";

export type WaitForProviderOptions = {
  /** Max wait time (ms). Default: 2000. */
  timeoutMs?: number;
  /** Poll interval (ms). Default: 50. */
  intervalMs?: number;
};

export function isDuskProvider(value: any): value is DuskProvider {
  return (
    value &&
    typeof value === "object" &&
    (value as any).isDusk === true &&
    typeof (value as any).request === "function" &&
    typeof (value as any).on === "function"
  );
}

/** Return the injected provider (`window.dusk`) if present. */
export function getDuskProvider(): DuskProvider | null {
  if (typeof window === "undefined") return null;
  const p = (window as any).dusk;
  return isDuskProvider(p) ? p : null;
}

/** Wait briefly for provider injection (`window.dusk`). */
export async function waitForDuskProvider(opts: WaitForProviderOptions = {}): Promise<DuskProvider | null> {
  const timeoutMs = opts.timeoutMs ?? 2_000;
  const intervalMs = opts.intervalMs ?? 50;

  const immediate = getDuskProvider();
  if (immediate) return immediate;
  if (typeof window === "undefined") return null;

  return await new Promise((resolve) => {
    const t0 = Date.now();
    const timer = window.setInterval(() => {
      const p = getDuskProvider();
      if (p) {
        window.clearInterval(timer);
        resolve(p);
        return;
      }
      if (Date.now() - t0 >= timeoutMs) {
        window.clearInterval(timer);
        resolve(null);
      }
    }, intervalMs);
  });
}

export type DuskWalletOptions = {
  /** Provide a provider explicitly (useful for tests). Defaults to `window.dusk`. */
  provider?: DuskProvider | null;

  /** If no provider is found synchronously, poll briefly for injection. Default: true. */
  waitForProvider?: boolean;

  /** Provider polling options (only used if `waitForProvider !== false`). */
  providerWaitOptions?: WaitForProviderOptions;

  /** Immediately fetch `dusk_chainId` and `dusk_accounts` on init. Default: true. */
  autoRefresh?: boolean;
};

export type DuskWalletSubscriber = (state: DuskWalletState) => void;

const initialState = (installed: boolean): DuskWalletState => ({
  installed,
  authorized: false,
  accounts: [],
  chainId: null,
  selectedAddress: null,
  node: null,
  lastUpdated: Date.now(),
});

const cloneState = (st: DuskWalletState): DuskWalletState => ({ ...st, accounts: [...st.accounts] });

const shallowArrayEq = (a: readonly unknown[], b: readonly unknown[]) => {
  if (a === b) return true;
  if (a.length != b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

const translateProviderError = (err: unknown): RpcErrorLike => {
  const e = normalizeError(err);
  switch (e.code) {
    case ERROR_CODES.UNSUPPORTED:
      return new DuskWalletNotInstalledError(e.message);
    case ERROR_CODES.DISCONNECTED:
      return new DuskWalletDisconnectedError(e.message);
    case ERROR_CODES.UNAUTHORIZED:
      return new DuskWalletUnauthorizedError(e.message);
    case ERROR_CODES.USER_REJECTED:
      return new DuskWalletUserRejectedError(e.message);
    default:
      return e;
  }
};

/** Wrapper around the injected provider with a small reactive state store. */
export class DuskWallet {
  private _provider: DuskProvider | null = null;
  private _state: DuskWalletState = initialState(false);
  private _subs = new Set<DuskWalletSubscriber>();
  private _bound = false;
  private _destroyed = false;
  private _readyPromise: Promise<void>;

  private _accountsFrom(value: unknown): AccountId[] {
    return Array.isArray(value) ? (value as AccountId[]) : [];
  }

  private _setAccounts(value: unknown, opts: { notify?: boolean } = {}) {
    const next = this._accountsFrom(value);
    const selectedAddress = next[0] ?? null;
    const sameAccounts = shallowArrayEq(this._state.accounts, next);
    if (sameAccounts && this._state.selectedAddress === selectedAddress) return;
    const notify = opts.notify ?? !sameAccounts;
    this._patch({ accounts: next, selectedAddress }, { notify });
  }

  private _setDisconnected() {
    if (!this._state.authorized && this._state.accounts.length === 0 && this._state.selectedAddress === null) return;
    this._patch({ authorized: false, accounts: [], selectedAddress: null });
  }

  private _hydrateFromProvider(p: DuskProvider, opts: { notify?: boolean } = {}) {
    this._patch(
      {
        installed: true,
        chainId: p.chainId ?? this._state.chainId,
        selectedAddress: p.selectedAddress ?? this._state.selectedAddress,
        authorized: Boolean(p.isAuthorized),
      },
      opts
    );
  }

  private _onConnect = (payload: DuskProviderEventMap["connect"]) => {
    const nextChainId = payload?.chainId ?? this._provider?.chainId ?? null;
    if (this._state.authorized && this._state.chainId === nextChainId) return;
    this._patch({ authorized: true, chainId: nextChainId });
  };

  private _onDisconnect = (_payload: DuskProviderEventMap["disconnect"]) => {
    this._setDisconnected();
  };

  private _onAccountsChanged = (accounts: DuskProviderEventMap["accountsChanged"]) => {
    this._setAccounts(accounts);
  };

  private _onChainChanged = (chainId: DuskProviderEventMap["chainChanged"]) => {
    if (typeof chainId !== "string" || chainId === this._state.chainId) return;
    this._patch({ chainId });
  };

  private _onNodeChanged = (payload: DuskProviderEventMap["duskNodeChanged"]) => {
    if (payload && typeof payload === "object") {
      this._patch({ node: payload as any, chainId: (payload as any).chainId ?? this._state.chainId });
    }
  };

  private _events: Array<[keyof DuskProviderEventMap, (payload: any) => void]> = [
    ["connect", this._onConnect],
    ["disconnect", this._onDisconnect],
    ["accountsChanged", this._onAccountsChanged],
    ["chainChanged", this._onChainChanged],
    ["duskNodeChanged", this._onNodeChanged],
  ];

  constructor(opts: DuskWalletOptions = {}) {
    this._provider = opts.provider ?? getDuskProvider();
    this._state = initialState(Boolean(this._provider));

    this._readyPromise = (async () => {
      if (!this._provider && opts.waitForProvider !== false) {
        this._provider = await waitForDuskProvider(opts.providerWaitOptions);
        this._patch({ installed: Boolean(this._provider) }, { notify: false });
      }

      if (this._provider) {
        this._bindProviderEvents();
        this._hydrateFromProvider(this._provider, { notify: false });
        if (opts.autoRefresh !== false) {
          await this.refresh().catch(() => {});
        }
      }

      this._notify();
    })();
  }

  private _getProvider(): DuskProvider | null {
    const p = this._provider ?? getDuskProvider();
    if (!p) return null;

    if (!this._provider) {
      this._provider = p;
      this._hydrateFromProvider(p, { notify: false });
      this._bindProviderEvents();
    }

    return p;
  }

  private _requireProvider(): DuskProvider {
    const p = this._getProvider();
    if (!p) throw new DuskWalletNotInstalledError();
    return p;
  }

  /** Resolves once initial provider detection/refresh finished. */
  async ready(): Promise<this> {
    await this._readyPromise;
    return this;
  }

  /** The injected provider, if present. */
  get provider(): DuskProvider | null {
    return this._provider;
  }

  /** Current reactive state (copy). */
  get state(): DuskWalletState {
    return cloneState(this._state);
  }

  /** Subscribe to state updates. Returns an unsubscribe function. */
  subscribe(fn: DuskWalletSubscriber): () => void {
    this._subs.add(fn);
    try {
      fn(this.state);
    } catch {
      // ignore
    }
    return () => {
      this._subs.delete(fn);
    };
  }

  /** Low-level request wrapper. */
  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    const p = this._requireProvider();
    try {
      return await p.request<T>({ method, params });
    } catch (err) {
      throw translateProviderError(err);
    }
  }

  /** Refresh chain id + accounts without prompting. */
  async refresh(): Promise<DuskWalletState> {
    const p = this._getProvider();
    if (!p) {
      this._patch({ installed: false });
      return this.state;
    }

    const [chainId, accounts] = await Promise.all([
      this.request<ChainId>("dusk_chainId").catch(() => p.chainId ?? null),
      this.request<AccountId[]>("dusk_accounts").catch(() => []),
    ]);

    const nextChainId = typeof chainId === "string" ? chainId : p.chainId ?? null;
    this._patch({ chainId: nextChainId, authorized: Boolean(p.isAuthorized) }, { notify: false });
    this._setAccounts(accounts, { notify: false });
    this._notify();

    return this.state;
  }

  /** Prompt the user to connect (permission grant). */
  async connect(): Promise<AccountId[]> {
    const accountsRaw = await this.request<AccountId[]>("dusk_requestAccounts");
    const accounts = this._accountsFrom(accountsRaw);

    this._patch({ authorized: true, chainId: this._provider?.chainId ?? this._state.chainId }, { notify: false });
    this._setAccounts(accounts, { notify: false });
    this._notify();

    return accounts;
  }

  /** Revoke the site's connection permission. */
  async disconnect(): Promise<boolean> {
    const res = await this.request<boolean>("dusk_disconnect");
    this._setDisconnected();
    return Boolean(res);
  }

  async getAccounts(): Promise<AccountId[]> {
    const accounts = await this.request<AccountId[]>("dusk_accounts");
    return this._accountsFrom(accounts);
  }

  async getChainId(): Promise<ChainId> {
    return await this.request<ChainId>("dusk_chainId");
  }

  /** Request the wallet to switch its selected chain (prompts user). */
  async switchChain(params: SwitchChainParams): Promise<null> {
    return await this.request<null>("dusk_switchNetwork", [params]);
  }

  async getPublicBalance(): Promise<BalanceResult> {
    return await this.request<BalanceResult>("dusk_getPublicBalance");
  }

  /** Fetch current gas price stats from the node mempool. */
  async getGasPrice(opts?: { maxTransactions?: number }): Promise<GasPriceResult> {
    return await this.request<GasPriceResult>("dusk_estimateGas", opts ?? {});
  }

  /** Fetch gas price with wallet-side caching. */
  async getCachedGasPrice(opts?: { forceRefresh?: boolean }): Promise<GasPriceResult> {
    return await this.request<GasPriceResult>("dusk_getCachedGasPrice", opts ?? {});
  }

  /** Get shielded sync status (no network call). */
  async getShieldedStatus(): Promise<ShieldedStatus> {
    return await this.request<ShieldedStatus>("dusk_getShieldedStatus");
  }

  /** Start a shielded sync in the wallet engine. */
  async syncShielded(opts?: { force?: boolean }): Promise<ShieldedSyncResult> {
    return await this.request<ShieldedSyncResult>("dusk_syncShielded", opts ?? {});
  }

  /** Set the shielded checkpoint to current chain tip. */
  async setShieldedCheckpointNow(opts?: { profileIndex?: number }): Promise<ShieldedCheckpoint> {
    return await this.request<ShieldedCheckpoint>("dusk_setShieldedCheckpointNow", opts ?? {});
  }

  /** Fetch shielded balance (total + spendable). */
  async getShieldedBalance(): Promise<ShieldedBalance> {
    return await this.request<ShieldedBalance>("dusk_getShieldedBalance");
  }

  async getAddresses(): Promise<Address[]> {
    const addrs = await this.request<Address[]>("dusk_getAddresses");
    return Array.isArray(addrs) ? addrs : [];
  }

  async sendTransaction(params: SendTransactionParams): Promise<TxResult> {
    return await this.request<TxResult>("dusk_sendTransaction", params);
  }

  async sendTransfer(params: Omit<Extract<SendTransactionParams, { kind: "transfer" }>, "kind">): Promise<TxResult> {
    return await this.sendTransaction({ kind: "transfer", ...params });
  }

  async sendContractCall(
    params: Omit<Extract<SendTransactionParams, { kind: "contract_call" }>, "kind">
  ): Promise<TxResult> {
    return await this.sendTransaction({ kind: "contract_call", ...params });
  }

  /** Proxy provider events (typed). Returns an unsubscribe function. */
  on<E extends keyof DuskProviderEventMap>(
    eventName: E,
    handler: (payload: DuskProviderEventMap[E]) => void
  ): () => void {
    const p = this._getProvider();
    if (!p) return () => {};
    p.on(eventName as string, handler as any);
    return () => p.off(eventName as string, handler as any);
  }

  /** Stop listening and free resources. */
  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this._unbindProviderEvents();
    this._subs.clear();
  }

  private _bindProviderEvents() {
    if (this._bound || !this._provider) return;
    this._bound = true;
    for (const [name, fn] of this._events) this._provider.on(name as string, fn as any);
  }

  private _unbindProviderEvents() {
    if (!this._bound || !this._provider) return;
    this._bound = false;
    for (const [name, fn] of this._events) this._provider.off(name as string, fn as any);
  }

  private _patch(partial: Partial<DuskWalletState>, opts: { notify?: boolean } = {}) {
    this._state = { ...this._state, ...partial, lastUpdated: Date.now() };
    if (opts.notify !== false) this._notify();
  }

  private _notify() {
    if (this._destroyed) return;
    const snapshot = this.state;
    for (const fn of this._subs) {
      try {
        fn(snapshot);
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Create a {@link DuskWallet} instance.
 *
 * Use this when you only need access to the injected provider (`window.dusk`):
 * connect, read accounts/chain, balances, and send transactions.
 *
 * If you later need contract-friendly helpers (readContract / writeContract),
 * you can pass this same wallet instance into `createDuskApp({ wallet, ... })`.
 *
 * @example
 * ```ts
 * import { createDuskWallet } from "@dusk-network/connect";
 *
 * const wallet = createDuskWallet();
 * await wallet.ready();
 *
 * await wallet.connect();
 * console.log(wallet.state.accounts);
 * ```
 */
export function createDuskWallet(opts?: DuskWalletOptions): DuskWallet {
  return new DuskWallet(opts);
}
