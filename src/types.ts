/**
 * Types for the Dusk wallet discovery + provider API.
 *
 * Wallets are discovered through Dusk-specific window events and expose
 * an EIP-1193-like provider object. All RPC methods are Dusk-prefixed (`dusk_*`).
 */

export type AccountId = string; // base58 public account identifier
export type Address = string; // base58 Dusk address
export type LuxString = string; // base-10, non-negative integer string (u64 semantics)

/**
 * Dusk wallet chain identifier (NOT Ethereum chain id).
 * Format: CAIP-2 `dusk:<id>` (e.g. `dusk:1`).
 */
export type ChainId = string;

export type Gas =
  | {
      /** gas limit in Lux (decimal string) */
      limit: LuxString;
      /** gas price in Lux (decimal string) */
      price: LuxString;
    }
  | null
  | undefined;

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

export type TxStatusUpdate =
  | { status: "submitted"; hash: string; nonce: string }
  | { status: "executing"; hash: string }
  | { status: "executed" | "failed" | "timeout"; hash: string; receipt: TxWaitReceipt };

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
  /**
   * Choose Moonlight (public) or Phoenix (shielded) transaction model.
   */
  privacy: PrivacyMode;
  to: AccountId | Address;
  amount: LuxString;
  memo?: string;
  gas?: Gas;
};

export type PrivacyMode = "public" | "shielded";

export type SendContractCallParams = {
  kind: "contract_call";
  /** Choose Moonlight (public) or Phoenix (shielded) transaction model. */
  privacy: PrivacyMode;
  contractId: string | number[] | Uint8Array; // must be 32 bytes
  fnName: string;
  fnArgs: ByteLike;
  amount?: LuxString;
  /** Contract-call deposit picked up by the called contract. */
  deposit?: LuxString;
  gas?: Gas;
  /**
   * OPTIONAL: extra decoded info shown to the user in the approval UI.
   * The wallet treats this as opaque JSON.
   */
  display?: unknown;
};

export type SendTransactionParams = SendTransferParams | SendContractCallParams;

export type WatchAssetParams =
  | {
      type: "DRC20";
      options: {
        /** 0x-prefixed 32-byte contract id */
        contractId: string | number[] | Uint8Array;
        /** Optional image URL hint (may be ignored by the wallet) */
        image?: string;
      };
    }
  | {
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

export type DuskProfile = {
  /** Opaque profile id scoped to this wallet/provider. */
  profileId: string;
  /** Public account id for this profile. */
  account: AccountId;
  /** Shareable shielded receive address, only present when explicitly approved. */
  shieldedAddress?: Address;
};

export type ConnectOptions = {
  /**
   * Request the selected profile's shareable shielded receive address as part
   * of the connection approval.
   */
  shieldedReceiveAddress?: boolean;
  /** Optional user-facing reason shown by wallets that support scoped prompts. */
  reason?: string;
  /** Optional user-facing label shown by wallets that support scoped prompts. */
  label?: string;
};

export type RequestShieldedAddressParams = {
  /**
   * Optional UX context shown by the wallet during approval.
   * Example: "payment_request".
   */
  reason?: string;
  /** Optional user-facing label for the address request. */
  label?: string;
  /** Optional public account context when the wallet supports account-scoped shielded addresses. */
  account?: AccountId;
};

export type RequestShieldedAddressResult = {
  /** Shareable shielded receive address approved by the user for this origin/request. */
  address: Address;
  account?: AccountId;
  profileId?: string;
  chainId?: ChainId;
};

export type RequestShieldedAddressResponse = Address | RequestShieldedAddressResult;

/**
 * Convenience preset ids understood by the wallet's switch RPC.
 *
 * NOTE: These are Dusk Wallet *presets* (not EVM chain ids). They are only
 * meaningful in the context of `dusk_switchNetwork`.
 */
export const DUSK_CHAIN_PRESETS = {
  local: "dusk:0",
  mainnet: "dusk:1",
  testnet: "dusk:2",
  devnet: "dusk:3",
} as const;

export type DuskChainPresetId = (typeof DUSK_CHAIN_PRESETS)[keyof typeof DUSK_CHAIN_PRESETS];

export type DuskRpcRequest = {
  method: string;
  params?: unknown;
};

export type DuskProviderInfo = {
  /** Stable wallet id (UUID recommended). */
  uuid: string;
  /** Human-friendly wallet name shown in pickers. */
  name: string;
  /** Icon URL/data URI shown in pickers. */
  icon: string;
  /** Reverse-DNS identifier, e.g. "network.dusk.wallet". */
  rdns: string;
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

  /**
   * Provider transport is the extension injection.
   * If the provider exists, it is "connected" to the extension.
   */
  isConnected(): boolean;

  /** Wallet chain id (CAIP-2) */
  readonly chainId: ChainId | null;

  /** Approved profile records visible to this origin. */
  readonly profiles: DuskProfile[];

  /** True after a successful connection approval for the current origin */
  readonly isAuthorized: boolean;
}

export type DuskProviderDetail = {
  info: DuskProviderInfo;
  provider: DuskProvider;
};

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
    /**
     * True when the wallet can prompt the user for a shareable shielded receive
     * address via `dusk_requestShieldedAddress`.
     */
    shieldedReceiveAddress?: boolean;
    signMessage: boolean;
    signAuth: boolean;
    contractCallPrivacy: boolean;
    watchAsset?: boolean;
  };
};

export type DuskProviderEventMap = {
  connect: { chainId: ChainId };
  disconnect: { code: number; message: string };
  profilesChanged: DuskProfile[];
  chainChanged: ChainId;
  duskNodeChanged: DuskNodeChangedPayload;
};

export type DuskWalletState = {
  /** Whether at least one Dusk wallet provider has been discovered */
  installed: boolean;
  /** Selected wallet id, if any */
  providerId: string | null;
  /** Selected wallet metadata, if any */
  providerInfo: DuskProviderInfo | null;
  /** All discovered wallet providers */
  availableProviders: DuskProviderInfo[];
  /** Whether the origin is authorized/connected */
  authorized: boolean;
  /** Accounts derived from `profiles`. Convenience only; profiles are canonical. */
  accounts: AccountId[];
  /** Exposed profile pairs for this origin. May omit shieldedAddress unless explicitly approved. */
  profiles: DuskProfile[];
  /** Wallet chain id */
  chainId: ChainId | null;
  /** First profile account, derived from `selectedProfile`. Convenience only. */
  selectedAddress: AccountId | null;
  /** First exposed profile, if any. */
  selectedProfile: DuskProfile | null;
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
  messageHash: string; // 0x...
  messageLen: number;
  signature: string; // 0x...
  payload: string; // 0x...
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
  signature: string; // 0x...
  payload: string; // 0x...
};
