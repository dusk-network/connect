import type { AccountId, Address, BalanceResult, ChainId, DuskProvider, DuskProviderEventMap, DuskWalletState, GasPriceResult, SendTransactionParams, ShieldedBalance, ShieldedCheckpoint, ShieldedStatus, ShieldedSyncResult, SwitchChainParams, TxResult } from "./types.js";
export type WaitForProviderOptions = {
    /** Max wait time (ms). Default: 2000. */
    timeoutMs?: number;
    /** Poll interval (ms). Default: 50. */
    intervalMs?: number;
};
export declare function isDuskProvider(value: any): value is DuskProvider;
/** Return the injected provider (`window.dusk`) if present. */
export declare function getDuskProvider(): DuskProvider | null;
/** Wait briefly for provider injection (`window.dusk`). */
export declare function waitForDuskProvider(opts?: WaitForProviderOptions): Promise<DuskProvider | null>;
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
/** Wrapper around the injected provider with a small reactive state store. */
export declare class DuskWallet {
    private _provider;
    private _state;
    private _subs;
    private _bound;
    private _destroyed;
    private _readyPromise;
    private _accountsFrom;
    private _setAccounts;
    private _setDisconnected;
    private _hydrateFromProvider;
    private _onConnect;
    private _onDisconnect;
    private _onAccountsChanged;
    private _onChainChanged;
    private _onNodeChanged;
    private _events;
    constructor(opts?: DuskWalletOptions);
    private _getProvider;
    private _requireProvider;
    /** Resolves once initial provider detection/refresh finished. */
    ready(): Promise<this>;
    /** The injected provider, if present. */
    get provider(): DuskProvider | null;
    /** Current reactive state (copy). */
    get state(): DuskWalletState;
    /** Subscribe to state updates. Returns an unsubscribe function. */
    subscribe(fn: DuskWalletSubscriber): () => void;
    /** Low-level request wrapper. */
    request<T = unknown>(method: string, params?: unknown): Promise<T>;
    /** Refresh chain id + accounts without prompting. */
    refresh(): Promise<DuskWalletState>;
    /** Prompt the user to connect (permission grant). */
    connect(): Promise<AccountId[]>;
    /** Revoke the site's connection permission. */
    disconnect(): Promise<boolean>;
    getAccounts(): Promise<AccountId[]>;
    getChainId(): Promise<ChainId>;
    /** Request the wallet to switch its selected chain (prompts user). */
    switchChain(params: SwitchChainParams): Promise<null>;
    getPublicBalance(): Promise<BalanceResult>;
    /** Fetch current gas price stats from the node mempool. */
    getGasPrice(opts?: {
        maxTransactions?: number;
    }): Promise<GasPriceResult>;
    /** Fetch gas price with wallet-side caching. */
    getCachedGasPrice(opts?: {
        forceRefresh?: boolean;
    }): Promise<GasPriceResult>;
    /** Get shielded sync status (no network call). */
    getShieldedStatus(): Promise<ShieldedStatus>;
    /** Start a shielded sync in the wallet engine. */
    syncShielded(opts?: {
        force?: boolean;
    }): Promise<ShieldedSyncResult>;
    /** Set the shielded checkpoint to current chain tip. */
    setShieldedCheckpointNow(opts?: {
        profileIndex?: number;
    }): Promise<ShieldedCheckpoint>;
    /** Fetch shielded balance (total + spendable). */
    getShieldedBalance(): Promise<ShieldedBalance>;
    getAddresses(): Promise<Address[]>;
    sendTransaction(params: SendTransactionParams): Promise<TxResult>;
    sendTransfer(params: Omit<Extract<SendTransactionParams, {
        kind: "transfer";
    }>, "kind">): Promise<TxResult>;
    sendContractCall(params: Omit<Extract<SendTransactionParams, {
        kind: "contract_call";
    }>, "kind">): Promise<TxResult>;
    /** Proxy provider events (typed). Returns an unsubscribe function. */
    on<E extends keyof DuskProviderEventMap>(eventName: E, handler: (payload: DuskProviderEventMap[E]) => void): () => void;
    /** Stop listening and free resources. */
    destroy(): void;
    private _bindProviderEvents;
    private _unbindProviderEvents;
    private _patch;
    private _notify;
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
 * import { createDuskWallet } from "mochavi-connect";
 *
 * const wallet = createDuskWallet();
 * await wallet.ready();
 *
 * await wallet.connect();
 * console.log(wallet.state.accounts);
 * ```
 */
export declare function createDuskWallet(opts?: DuskWalletOptions): DuskWallet;
//# sourceMappingURL=wallet.d.ts.map