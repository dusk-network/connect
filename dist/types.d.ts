/**
 * Types for the Dusk Wallet injected provider API.
 *
 * The wallet injects `window.dusk` with an EIP-1193-like interface.
 * All RPC methods are Dusk-prefixed (`dusk_*`).
 */
export type AccountId = string;
export type Address = string;
export type LuxString = string;
/**
 * Dusk wallet chain identifier (NOT Ethereum chain id).
 * Format: CAIP-2 `dusk:<id>` (e.g. `dusk:1`).
 */
export type ChainId = string;
export type Gas = {
    /** gas limit in Lux (decimal string) */
    limit: LuxString;
    /** gas price in Lux (decimal string) */
    price: LuxString;
} | null | undefined;
export type TxResult = {
    /** tx hash string (as produced by the protocol driver) */
    hash: string;
    /** nonce as decimal string (only present for public/Moonlight txs) */
    nonce?: string;
};
/**
 * Transaction execution status as observed from the node.
 *
 * - `executed`: included + processed by the node (best-effort)
 * - `failed`: executed event indicates an error (best-effort)
 * - `timeout`: timed out waiting for the executed event
 */
export type TxWaitStatus = "executed" | "failed" | "timeout";
export type WaitForTxOptions = {
    /** How long to wait before returning a `timeout` receipt. Default: 60_000ms. */
    timeoutMs?: number;
    /** AbortSignal to cancel the wait. */
    signal?: AbortSignal;
};
/**
 * Receipt-like result returned by `tx.wait()` / `dusk.waitForTxReceipt()`.
 *
 * NOTE: this is **best-effort** and depends on the node event payload format.
 */
export type TxWaitReceipt = {
    hash: string;
    status: TxWaitStatus;
    ok: boolean;
    /** Optional error string when `ok === false` */
    error?: string;
    /** Raw executed event (headers + payload) when available */
    event?: unknown;
};
/**
 * High-level transaction lifecycle updates emitted by a {@link TxHandle}.
 *
 * - `submitted`: the wallet returned a tx hash (tx accepted for processing)
 * - `executing`: we've started waiting for the node's `Executed` event
 * - `executed` / `failed` / `timeout`: final status (includes a receipt)
 */
export type TxStatus = "submitted" | "executing" | "executed" | "failed" | "timeout";
export type TxStatusUpdate = {
    status: "submitted";
    hash: string;
    nonce: string;
} | {
    status: "executing";
    hash: string;
} | {
    status: "executed" | "failed" | "timeout";
    hash: string;
    receipt: TxWaitReceipt;
};
/**
 * A submitted tx result enhanced with helpers to wait for execution.
 *
 * This is similar to `viem`'s `waitForTransactionReceipt`, but bundled with
 * the tx hash so examples can stay tight.
 */
export type TxHandle = TxResult & {
    /** Wait until the tx is executed (or timeout). */
    wait(options?: WaitForTxOptions): Promise<TxWaitReceipt>;
    /** Alias for `wait()` */
    waitExecuted(options?: WaitForTxOptions): Promise<TxWaitReceipt>;
    /**
     * Subscribe to lifecycle updates for this tx.
     *
     * The handler is called immediately with the current status.
     * Returns an `unsubscribe()` function.
     */
    onStatus(handler: (update: TxStatusUpdate) => void): () => void;
};
export type BalanceResult = {
    /** nonce as decimal string */
    nonce: string;
    /** balance in Lux (decimal string) */
    value: LuxString;
};
export type GasPriceResult = {
    /** average gas price in Lux (decimal string) */
    average: LuxString;
    /** max gas price in Lux (decimal string) */
    max: LuxString;
    /** median gas price in Lux (decimal string) */
    median: LuxString;
    /** min gas price in Lux (decimal string) */
    min: LuxString;
};
export type ByteLike = string | number[] | Uint8Array | ArrayBuffer;
export type SendTransferParams = {
    kind: "transfer";
    to: AccountId | Address;
    amount: LuxString;
    memo?: string;
    gas?: Gas;
};
export type PrivacyMode = "public" | "shielded";
export type SendContractCallParams = {
    kind: "contract_call";
    /** Choose Moonlight (public) or Phoenix (shielded) transaction model. Default: "public". */
    privacy?: PrivacyMode;
    contractId: string | number[] | Uint8Array;
    fnName: string;
    fnArgs: ByteLike;
    amount?: LuxString;
    deposit?: LuxString;
    gas?: Gas;
    /**
     * OPTIONAL: extra decoded info shown to the user in the approval UI.
     * The wallet treats this as opaque JSON.
     */
    display?: unknown;
};
export type SendTransactionParams = SendTransferParams | SendContractCallParams;
export type WatchAssetParams = {
    type: "DRC20";
    options: {
        /** 0x-prefixed 32-byte contract id */
        contractId: string | number[] | Uint8Array;
        /** Optional image URL hint (may be ignored by the wallet) */
        image?: string;
    };
} | {
    type: "DRC721";
    options: {
        /** 0x-prefixed 32-byte contract id */
        contractId: string | number[] | Uint8Array;
        /** Token id as u64 decimal string */
        tokenId: string | bigint;
        /** Optional image URL hint (may be ignored by the wallet) */
        image?: string;
    };
};
/**
 * Switch the wallet's selected network (aka "chain").
 *
 * The wallet accepts either:
 * - `{ chainId: "dusk:1" }` for known presets, OR
 * - `{ nodeUrl: "https://..." }` for a custom node.
 *
 * The wallet exposes this RPC as `dusk_switchNetwork`.
 */
export type SwitchChainParams = {
    /** Preset chain id like "dusk:1" (mainnet), "dusk:2" (testnet) ... */
    chainId?: ChainId;
    /** Custom network node URL */
    nodeUrl?: string;
};
/**
 * Convenience preset ids understood by the wallet's switch RPC.
 *
 * NOTE: These are Dusk Wallet *presets* (not EVM chain ids). They are only
 * meaningful in the context of `dusk_switchNetwork`.
 */
export declare const DUSK_CHAIN_PRESETS: {
    readonly local: "dusk:0";
    readonly mainnet: "dusk:1";
    readonly testnet: "dusk:2";
    readonly devnet: "dusk:3";
};
export type DuskChainPresetId = (typeof DUSK_CHAIN_PRESETS)[keyof typeof DUSK_CHAIN_PRESETS];
export type DuskRpcRequest = {
    method: string;
    params?: unknown;
};
export interface DuskProvider {
    /** true if this object is the Dusk Wallet provider */
    readonly isDusk: true;
    /**
     * Send a JSON-RPC-like request to the wallet.
     */
    request<T = unknown>(args: DuskRpcRequest): Promise<T>;
    /**
     * Subscribe to provider events.
     */
    on(eventName: string, handler: (...args: any[]) => void): void;
    once(eventName: string, handler: (...args: any[]) => void): void;
    removeListener(eventName: string, handler: (...args: any[]) => void): void;
    off(eventName: string, handler: (...args: any[]) => void): void;
    removeAllListeners(eventName?: string): void;
    /** Legacy convenience (calls `dusk_requestAccounts`) */
    enable(): Promise<AccountId[]>;
    /**
     * Provider transport is the extension injection.
     * If the provider exists, it is "connected" to the extension.
     */
    isConnected(): boolean;
    /** Wallet chain id (CAIP-2) */
    readonly chainId: ChainId | null;
    /** First exposed account id (if any) */
    readonly selectedAddress: AccountId | null;
    /** True after a successful connection approval for the current origin */
    readonly isAuthorized: boolean;
}
export type DuskNodeChangedPayload = {
    chainId: ChainId;
    nodeUrl: string;
    networkName: string;
};
export type DuskProviderCapabilities = {
    provider: string;
    walletVersion: string;
    chainId: ChainId;
    nodeUrl: string;
    networkName: string;
    methods: string[];
    txKinds: string[];
    limits: {
        maxFnArgsBytes: number;
        maxFnNameChars: number;
        maxMemoBytes: number;
    };
    features: {
        shieldedRead: boolean;
        shieldedRecipients: boolean;
        signMessage: boolean;
        signAuth: boolean;
        contractCallPrivacy: boolean;
        watchAsset?: boolean;
    };
};
export type DuskProviderEventMap = {
    connect: {
        chainId: ChainId;
    };
    disconnect: {
        code: number;
        message: string;
    };
    accountsChanged: AccountId[];
    chainChanged: ChainId;
    duskNodeChanged: DuskNodeChangedPayload;
};
export type DuskWalletState = {
    /** Whether `window.dusk` is present */
    installed: boolean;
    /** Whether the origin is authorized/connected */
    authorized: boolean;
    /** Exposed accounts for this origin */
    accounts: AccountId[];
    /** Wallet chain id */
    chainId: ChainId | null;
    /** First account (if any) */
    selectedAddress: AccountId | null;
    /** Last `duskNodeChanged` payload (if any) */
    node: DuskNodeChangedPayload | null;
    /** Provider capability snapshot (if supported by the wallet) */
    capabilities: DuskProviderCapabilities | null;
    /** epoch ms */
    lastUpdated: number;
};
export type SignMessageResult = {
    account: AccountId;
    origin: string;
    chainId: ChainId;
    messageHash: string;
    messageLen: number;
    signature: string;
    payload: string;
};
export type SignAuthParams = {
    nonce: string;
    statement?: string;
    expiresAt?: string;
};
export type SignAuthResult = {
    account: AccountId;
    origin: string;
    chainId: ChainId;
    nonce: string;
    issuedAt: string;
    expiresAt: string;
    message: string;
    signature: string;
    payload: string;
};
//# sourceMappingURL=types.d.ts.map