import type { SendTransactionParams, SwitchChainParams, TxHandle, TxWaitReceipt, WaitForTxOptions, DuskWalletState } from "./types.js";
import type { DuskWalletOptions } from "./wallet.js";
import type { DuskDataDriver } from "./driver.js";
import type { ContractCallOptions } from "./node.js";
import { DuskWallet } from "./wallet.js";
import { type EnsureChainOptions } from "./ensureChain.js";
import { type DuskContract, type DuskContractTxOverrides } from "./contract.js";
export type DuskAppContract = {
    /** 0x-prefixed 32-byte contract id */
    contractId: string;
    /** URL (relative or absolute) to the compiled data-driver wasm */
    driverUrl: string;
    /** Optional human-friendly contract name (for wallet display) */
    name?: string;
    /** Optional fnName -> signature mapping shown in wallet display */
    methodSigs?: Record<string, string>;
    /** Optional default tx overrides */
    defaultTx?: DuskContractTxOverrides;
};
export type DuskAppOptions = {
    /** Provide an existing wallet instance or wallet constructor options */
    wallet?: DuskWallet | DuskWalletOptions;
    /** Fallback node URL for reads (used when the wallet hasn't emitted `duskNodeChanged`). */
    nodeUrl?: string;
    /** Default chain target enforced before write calls (via ensureChain). */
    chain?: SwitchChainParams;
    /** If true, call wallet.connect() when not authorized. Default: true */
    autoConnect?: boolean;
    /** Optional contract presets, so dApps can refer to contracts by name. */
    contracts?: Record<string, DuskAppContract>;
    /** Disable internal data-driver caching (advanced). Default: false. */
    disableDriverCache?: boolean;
};
export type ReadContractParams = {
    /** Contract preset name or inline contract config */
    contract: string | DuskAppContract;
    /** Function name */
    functionName: string;
    /** JSON value passed to the data-driver */
    args?: unknown;
    /** Low-level node options (feeder mode, AbortSignal). */
    options?: ContractCallOptions;
};
/** Tx override fields that map 1:1 to `wallet.sendContractCall(...)`. */
export type ContractTxOverrides = DuskContractTxOverrides;
export type PrepareContractCallParams = ReadContractParams & ContractTxOverrides;
export type WriteContractParams = PrepareContractCallParams & {
    /** If true, call wallet.connect() when not authorized. Default: true */
    autoConnect?: boolean;
    /** Optional chain target enforced before sending (uses ensureChain) */
    chain?: SwitchChainParams;
};
export type PreparedContractCall = Omit<Extract<SendTransactionParams, {
    kind: "contract_call";
}>, "kind">;
export type DuskApp = {
    wallet: DuskWallet;
    /** Convenience access to the current wallet state */
    readonly state: DuskWalletState;
    /** Subscribe to wallet state changes */
    subscribe: DuskWallet["subscribe"];
    /** Wallet passthroughs */
    connect: DuskWallet["connect"];
    disconnect: DuskWallet["disconnect"];
    switchChain: DuskWallet["switchChain"];
    /** Resolve once initial provider detection/refresh completed */
    ready(): Promise<DuskWallet>;
    /** Best-effort node URL resolver */
    nodeUrl(): string;
    /** Ensure a target chain (only prompts if a switch is needed) */
    ensureChain(target: SwitchChainParams, options?: EnsureChainOptions): Promise<boolean>;
    /** Get (and cache) a data-driver from a wasm URL */
    driver(driverUrl: string): Promise<DuskDataDriver>;
    /** Create a proxy-based contract facade (call/tx/write). */
    contract(presetOrOpts: string | (DuskAppContract & {
        /** Optional override for this facade only */
        chain?: SwitchChainParams;
        /** Optional override for this facade only */
        autoConnect?: boolean;
    })): DuskContract;
    /** Read from a contract (node call + data-driver decode) */
    readContract(params: ReadContractParams): Promise<any>;
    /** Build wallet-ready params for a contract call (data-driver encode) */
    prepareContractCall(params: PrepareContractCallParams): Promise<PreparedContractCall>;
    /** Send a contract call via the wallet (auto-connect + optional ensureChain) */
    writeContract(params: WriteContractParams): Promise<TxHandle>;
    /**
     * Wait until a tx hash is **executed** (included + processed) on the node.
     *
     * Internally uses RUES events (WebSocket) when available.
     * Returns `null` on timeout.
     */
    waitForTx(hash: string, options?: {
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<any | null>;
    /**
     * Wait until a tx is executed and return a small receipt-like object.
     *
     * This is the ergonomic version of `waitForTx()` (which returns the raw event).
     */
    waitForTxReceipt(hash: string, options?: WaitForTxOptions): Promise<TxWaitReceipt>;
    /** Expose presets (if any) */
    contracts: Record<string, DuskAppContract>;
};
/**
 * Create an app-level facade for **contract dApp developers**.
 *
 * `createDuskApp()` bundles together:
 *
 * - a {@link DuskWallet} instance (`dusk.wallet`)
 * - a node client for read-only contract calls
 * - a WASM data-driver loader/cache (for local encode/decode)
 * - ergonomic helpers:
 *   - `readContract()`
 *   - `prepareContractCall()`
 *   - `writeContract()`
 *
 * It does **not** include any UI by itself. UI components (connect button/modal)
 * should be wired to the underlying wallet: `button.wallet = dusk.wallet`.
 *
 * @example
 * ```ts
 * import { createDuskApp, DUSK_CHAIN_PRESETS } from "mochavi-connect";
 *
 * const dusk = createDuskApp({
 *   nodeUrl: "https://testnet.nodes.dusk.network",
 *   chain: { chainId: DUSK_CHAIN_PRESETS.testnet },
 *   contracts: {
 *     myContract: {
 *       contractId: "0x...",
 *       driverUrl: "/data_driver.wasm",
 *     },
 *   },
 * });
 *
 * await dusk.ready();
 * const state = await dusk.readContract({ contract: "myContract", functionName: "current_state" });
 * ```
 */
export declare function createDuskApp(opts?: DuskAppOptions): DuskApp;
//# sourceMappingURL=app.d.ts.map