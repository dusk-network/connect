import type { AccountId, Gas, LuxString, SwitchChainParams, TxHandle } from "./types.js";
import type { DuskWallet } from "./wallet.js";
import type { DuskDataDriver } from "./driver.js";
import type { ContractCallOptions, DuskNodeClient } from "./node.js";
export type DuskContractTxOverrides = {
    to?: AccountId;
    amount?: LuxString;
    deposit?: LuxString;
    gas?: Gas;
    /** Extra decoded info shown to the user in the wallet approval UI. */
    display?: unknown;
};
export type DuskContractWriteOptions = DuskContractTxOverrides & {
    /** If true, call wallet.connect() when not authorized. Default: true */
    autoConnect?: boolean;
    /** Optional chain target enforced before sending (uses ensureChain) */
    chain?: SwitchChainParams;
};
export type CreateDuskContractOptions = {
    contractId: string | Uint8Array | number[];
    driver: DuskDataDriver | Promise<DuskDataDriver>;
    /** Optional node client for read-only calls (contract.call.*). */
    node?: DuskNodeClient | null;
    /** Optional wallet for write calls (contract.write.*). */
    wallet?: DuskWallet | null;
    /** Contract name used in tx display, if provided. */
    name?: string;
    /** Optional map of fnName -> method signature, shown in tx display. */
    methodSigs?: Record<string, string>;
    /** Default tx overrides (amount/deposit/gas/to/display). */
    defaultTx?: DuskContractTxOverrides;
    /** Default chain enforced on write, if provided. */
    chain?: SwitchChainParams;
    /** Default autoConnect for writes. Default: true */
    autoConnect?: boolean;
};
export type DuskContract = {
    /** 0x-prefixed 32-byte contract id */
    readonly id: string;
    /** Driver metadata */
    schema(): Promise<any>;
    version(): Promise<string>;
    /** Encode a function's input using the data-driver (JSON -> RKYV). */
    encode(fnName: string, args?: unknown): Promise<Uint8Array>;
    /** Read-only contract call facade: contract.call.<fn>(args?, opts?) */
    readonly call: Record<string, (args?: unknown, opts?: ContractCallOptions) => Promise<any>>;
    /** Tx builder facade: contract.tx.<fn>(args?, overrides?) -> params for wallet.sendContractCall */
    readonly tx: Record<string, (args?: unknown, overrides?: DuskContractTxOverrides) => Promise<any>>;
    /** Write facade: contract.write.<fn>(args?, overrides?) -> wallet.sendContractCall(...) */
    readonly write: Record<string, (args?: unknown, overrides?: DuskContractWriteOptions) => Promise<TxHandle>>;
};
export declare function createDuskContract(opts: CreateDuskContractOptions): DuskContract;
//# sourceMappingURL=contract.d.ts.map