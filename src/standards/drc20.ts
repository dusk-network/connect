import type { LuxString, TxHandle } from "../types.js";
import type {
  CreateDuskContractOptions,
  DuskContract,
  DuskContractTxOverrides,
  DuskContractWriteOptions,
} from "../contract.js";
import type { DuskDataDriver } from "../driver.js";
import type { DrcAccount } from "./types.js";

import { createDuskContract } from "../contract.js";
import { fetchWasmDataDriver } from "../driver.js";

export type Drc20BalanceOf = { account: DrcAccount };
export type Drc20Allowance = { owner: DrcAccount; spender: DrcAccount };

export type Drc20TransferCall = { to: DrcAccount; value: LuxString };
export type Drc20ApproveCall = { spender: DrcAccount; value: LuxString };
export type Drc20TransferFromCall = { owner: DrcAccount; to: DrcAccount; value: LuxString };

export const DRC20_METHOD_SIGS: Record<string, string> = {
  // Views
  name: "name()",
  symbol: "symbol()",
  decimals: "decimals()",
  total_supply: "total_supply()",
  balance_of: "balance_of(account: Account)",
  allowance: "allowance(owner: Account, spender: Account)",
  // State-changing
  transfer: "transfer(to: Account, value: u64)",
  approve: "approve(spender: Account, value: u64)",
  transfer_from: "transfer_from(owner: Account, to: Account, value: u64)",
};

function mergeDisplay(base: any, extra: unknown): unknown {
  if (extra && typeof extra === "object") return { ...base, ...(extra as any) };
  if (extra == null) return base;
  return { ...base, display: extra };
}

function isMaxU64(v: unknown): boolean {
  try {
    return BigInt(String(v ?? "")) === 18446744073709551615n;
  } catch {
    return false;
  }
}

function buildDrc20Display(op: string, args: unknown): any {
  const a: any = args && typeof args === "object" ? (args as any) : {};
  return {
    standard: "DRC20",
    op,
    ...(op === "transfer" ? { to: a.to, valueUnits: String(a.value ?? "") } : {}),
    ...(op === "approve"
      ? {
          spender: a.spender,
          valueUnits: String(a.value ?? ""),
          isMax: isMaxU64(a.value),
        }
      : {}),
    ...(op === "transfer_from"
      ? { owner: a.owner, to: a.to, valueUnits: String(a.value ?? "") }
      : {}),
  };
}

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

export function asDrc20(contract: DuskContract): Drc20Contract {
  return {
    contract,
    read: {
      name: () => contract.call["name"]!() as Promise<string>,
      symbol: () => contract.call["symbol"]!() as Promise<string>,
      decimals: async () => Number(await (contract.call["decimals"]!() as Promise<any>)),
      totalSupply: async (callOpts) => String(await contract.call["total_supply"]!(null, callOpts)),
      balanceOf: async (args, callOpts) => String(await contract.call["balance_of"]!(args, callOpts)),
      allowance: async (args, callOpts) => String(await contract.call["allowance"]!(args, callOpts)),
    },
    tx: {
      transfer: async (args, overrides) =>
        await contract.tx["transfer"]!(args, {
          ...(overrides ?? {}),
          display: mergeDisplay(buildDrc20Display("transfer", args), overrides?.display),
        }),
      approve: async (args, overrides) =>
        await contract.tx["approve"]!(args, {
          ...(overrides ?? {}),
          display: mergeDisplay(buildDrc20Display("approve", args), overrides?.display),
        }),
      transferFrom: async (args, overrides) =>
        await contract.tx["transfer_from"]!(args, {
          ...(overrides ?? {}),
          display: mergeDisplay(buildDrc20Display("transfer_from", args), overrides?.display),
        }),
    },
    write: {
      transfer: async (args, overrides) =>
        await contract.write["transfer"]!(args, {
          ...(overrides ?? {}),
          display: mergeDisplay(buildDrc20Display("transfer", args), overrides?.display),
        }),
      approve: async (args, overrides) =>
        await contract.write["approve"]!(args, {
          ...(overrides ?? {}),
          display: mergeDisplay(buildDrc20Display("approve", args), overrides?.display),
        }),
      transferFrom: async (args, overrides) =>
        await contract.write["transfer_from"]!(args, {
          ...(overrides ?? {}),
          display: mergeDisplay(buildDrc20Display("transfer_from", args), overrides?.display),
        }),
    },
  };
}

export function createDrc20(opts: CreateDrc20Options): Drc20Contract {
  const driver = opts.driver ?? (opts.driverUrl ? fetchWasmDataDriver(opts.driverUrl) : null);
  if (!driver) throw new Error("createDrc20: driver or driverUrl is required");

  const contract = createDuskContract({
    ...opts,
    driver,
    name: opts.name ?? "DRC20",
    methodSigs: { ...DRC20_METHOD_SIGS, ...(opts.methodSigs ?? {}) },
  });

  return asDrc20(contract);
}
