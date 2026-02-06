import type { LuxString, TxHandle } from "../types.js";
import type { CreateDuskContractOptions, DuskContract, DuskContractTxOverrides, DuskContractWriteOptions } from "../contract.js";
import type { DuskDataDriver } from "../driver.js";
import type { DrcAccount } from "./types.js";
export type Drc721BalanceOf = {
    account: DrcAccount;
};
export type Drc721OwnerOf = {
    token_id: LuxString;
};
export type Drc721TokenUri = {
    token_id: LuxString;
};
export type Drc721GetApproved = {
    token_id: LuxString;
};
export type Drc721IsApprovedForAll = {
    owner: DrcAccount;
    operator: DrcAccount;
};
export type Drc721ApproveCall = {
    approved: DrcAccount;
    token_id: LuxString;
};
export type Drc721SetApprovalForAllCall = {
    operator: DrcAccount;
    approved: boolean;
};
export type Drc721TransferFromCall = {
    from: DrcAccount;
    to: DrcAccount;
    token_id: LuxString;
};
export declare const DRC721_METHOD_SIGS: Record<string, string>;
export type CreateDrc721Options = Omit<CreateDuskContractOptions, "driver" | "methodSigs"> & {
    /** Driver instance or promise. Prefer passing a cached promise for repeated calls. */
    driver?: DuskDataDriver | Promise<DuskDataDriver>;
    /** Optional driver URL (WASM). Used when `driver` is not provided. */
    driverUrl?: string;
    /** Optional contract name shown in wallet approval UI. Default: "DRC721". */
    name?: string;
    /** Optional extra method signature hints shown in wallet approval UI. */
    methodSigs?: Record<string, string>;
};
export type Drc721Contract = {
    contract: DuskContract;
    read: {
        name(): Promise<string>;
        symbol(): Promise<string>;
        baseUri(): Promise<string>;
        totalSupply(opts?: any): Promise<string>;
        balanceOf(args: Drc721BalanceOf, opts?: any): Promise<string>;
        ownerOf(args: Drc721OwnerOf, opts?: any): Promise<any>;
        tokenUri(args: Drc721TokenUri, opts?: any): Promise<string>;
        getApproved(args: Drc721GetApproved, opts?: any): Promise<any>;
        isApprovedForAll(args: Drc721IsApprovedForAll, opts?: any): Promise<boolean>;
    };
    tx: {
        approve(args: Drc721ApproveCall, overrides?: DuskContractTxOverrides): Promise<any>;
        setApprovalForAll(args: Drc721SetApprovalForAllCall, overrides?: DuskContractTxOverrides): Promise<any>;
        transferFrom(args: Drc721TransferFromCall, overrides?: DuskContractTxOverrides): Promise<any>;
    };
    write: {
        approve(args: Drc721ApproveCall, overrides?: DuskContractWriteOptions): Promise<TxHandle>;
        setApprovalForAll(args: Drc721SetApprovalForAllCall, overrides?: DuskContractWriteOptions): Promise<TxHandle>;
        transferFrom(args: Drc721TransferFromCall, overrides?: DuskContractWriteOptions): Promise<TxHandle>;
    };
};
export declare function asDrc721(contract: DuskContract): Drc721Contract;
export declare function createDrc721(opts: CreateDrc721Options): Drc721Contract;
//# sourceMappingURL=drc721.d.ts.map