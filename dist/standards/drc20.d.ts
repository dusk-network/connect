import type { LuxString, TxHandle } from "../types.js";
import type { CreateDuskContractOptions, DuskContract, DuskContractTxOverrides, DuskContractWriteOptions } from "../contract.js";
import type { DuskDataDriver } from "../driver.js";
import type { DrcAccount } from "./types.js";
export type Drc20BalanceOf = {
    account: DrcAccount;
};
export type Drc20Allowance = {
    owner: DrcAccount;
    spender: DrcAccount;
};
export type Drc20TransferCall = {
    to: DrcAccount;
    value: LuxString;
};
export type Drc20ApproveCall = {
    spender: DrcAccount;
    value: LuxString;
};
export type Drc20TransferFromCall = {
    owner: DrcAccount;
    to: DrcAccount;
    value: LuxString;
};
export declare const DRC20_METHOD_SIGS: Record<string, string>;
export type CreateDrc20Options = Omit<CreateDuskContractOptions, "driver" | "methodSigs"> & {
    /** Driver instance or promise. Prefer passing a cached promise for repeated calls. */
    driver?: DuskDataDriver | Promise<DuskDataDriver>;
    /** Optional driver URL (WASM). Used when `driver` is not provided. */
    driverUrl?: string;
    /** Optional contract name shown in wallet approval UI. Default: "DRC20". */
    name?: string;
    /** Optional extra method signature hints shown in wallet approval UI. */
    methodSigs?: Record<string, string>;
};
export type Drc20Contract = {
    contract: DuskContract;
    read: {
        name(): Promise<string>;
        symbol(): Promise<string>;
        decimals(): Promise<number>;
        totalSupply(opts?: any): Promise<string>;
        balanceOf(args: Drc20BalanceOf, opts?: any): Promise<string>;
        allowance(args: Drc20Allowance, opts?: any): Promise<string>;
    };
    tx: {
        transfer(args: Drc20TransferCall, overrides?: DuskContractTxOverrides): Promise<any>;
        approve(args: Drc20ApproveCall, overrides?: DuskContractTxOverrides): Promise<any>;
        transferFrom(args: Drc20TransferFromCall, overrides?: DuskContractTxOverrides): Promise<any>;
    };
    write: {
        transfer(args: Drc20TransferCall, overrides?: DuskContractWriteOptions): Promise<TxHandle>;
        approve(args: Drc20ApproveCall, overrides?: DuskContractWriteOptions): Promise<TxHandle>;
        transferFrom(args: Drc20TransferFromCall, overrides?: DuskContractWriteOptions): Promise<TxHandle>;
    };
};
export declare function asDrc20(contract: DuskContract): Drc20Contract;
export declare function createDrc20(opts: CreateDrc20Options): Drc20Contract;
//# sourceMappingURL=drc20.d.ts.map