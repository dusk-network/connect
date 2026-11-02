import type { LuxString, TxHandle } from "../types.js";
import type {
  CreateDuskContractOptions,
  DuskContract,
  DuskContractTxOverrides,
  DuskContractWriteOptions,
} from "../contract.js";
import type { DuskDataDriver } from "../driver.js";
import type { DrcPrincipal } from "./types.js";

import { accountToHex } from "../account.js";
import { createDuskContract } from "../contract.js";
import { fetchWasmDataDriver } from "../driver.js";
import { normalizeContractId0x } from "../internal/contractId.js";

/** A DRC20 amount in the token's base units: a bigint or a decimal string. */
export type Drc20Amount = bigint | LuxString;

/** Arguments for DRC20 `balance_of` (`BalanceOf`). */
export type Drc20BalanceOf = { account: DrcPrincipal };

/** Arguments for DRC20 `allowance` (`Allowance`). */
export type Drc20Allowance = { owner: DrcPrincipal; spender: DrcPrincipal };

/** Arguments for DRC20 `transfer` (`TransferCall`). */
export type Drc20TransferCall = { to: DrcPrincipal; amount: Drc20Amount };

/** Arguments for DRC20 `approve` (`ApproveCall`). */
export type Drc20ApproveCall = { spender: DrcPrincipal; amount: Drc20Amount };

/** Arguments for DRC20 `transfer_from` (`TransferFromCall`). */
export type Drc20TransferFromCall = { owner: DrcPrincipal; to: DrcPrincipal; amount: Drc20Amount };

/** Method signatures of the DRC20 standard in dusk-network/contracts. */
export const DRC20_METHOD_SIGS: Record<string, string> = {
  // Views
  name: "name()",
  symbol: "symbol()",
  decimals: "decimals()",
  total_supply: "total_supply()",
  balance_of: "balance_of(BalanceOf { account: Principal })",
  allowance: "allowance(Allowance { owner: Principal, spender: Principal })",
  // State-changing
  transfer: "transfer(TransferCall { to: Principal, amount: u64 })",
  approve: "approve(ApproveCall { spender: Principal, amount: u64 })",
  transfer_from: "transfer_from(TransferFromCall { owner: Principal, to: Principal, amount: u64 })",
};

const U64_MAX = 18446744073709551615n;
const json = JSON as typeof JSON & { rawJSON?: (text: string) => unknown };

/**
 * Build a DRC principal from a Base58 Moonlight account or a 32-byte contract id
 * (hex, with or without `0x`). For a Phoenix principal, pass `{ Phoenix: key }`.
 */
export function drcPrincipal(addressOrContractId: string): DrcPrincipal {
  const value = String(addressOrContractId ?? "").trim();
  if (/^(0x)?[0-9a-f]{64}$/i.test(value)) return { Contract: normalizeContractId0x(value).slice(2) };
  accountToHex(value); // Throws unless it is a Base58 Moonlight account.
  return { Moonlight: value };
}

// The standard's JSON: one kind, a key as Base58 or a contract id as hex without `0x`.
function principal(value: DrcPrincipal): DrcPrincipal {
  const entries = value && typeof value === "object" ? Object.entries(value) : [];
  const [kind, key] = entries.length === 1 ? entries[0]! : [];
  if (typeof key === "string" && key.trim()) {
    if (kind === "Contract") return { Contract: normalizeContractId0x(key.trim()).slice(2) };
    if (kind === "Moonlight") return { Moonlight: key.trim() };
    if (kind === "Phoenix") return { Phoenix: key.trim() };
  }
  throw new TypeError("A DRC principal is { Moonlight }, { Phoenix } or { Contract }");
}

function u64(value: Drc20Amount): bigint {
  const amount = typeof value === "bigint" ? value
    : typeof value === "string" && /^\d+$/.test(value.trim()) ? BigInt(value.trim()) : -1n;
  if (amount < 0n || amount > U64_MAX) {
    throw new RangeError("A DRC20 amount is a whole number from 0 to 18446744073709551615");
  }
  return amount;
}

// The standard's data-driver reads a u64 as a JSON integer. Write it exactly; where the
// runtime can't write a large one, send a decimal string for drivers that read those.
function u64Json(amount: bigint): unknown {
  if (amount <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(amount);
  return json.rawJSON ? json.rawJSON(amount.toString()) : amount.toString();
}

function mergeDisplay(base: any, extra: unknown): unknown {
  if (extra && typeof extra === "object") return { ...base, ...(extra as any) };
  if (extra == null) return base;
  return { ...base, display: extra };
}

type Drc20Op = "transfer" | "approve" | "transfer_from";

// The standard's struct argument for `op`, and what the wallet shows for it.
function drc20Call(op: Drc20Op, args: any): { input: unknown; display: unknown } {
  const amount = u64(args?.amount);
  const parties =
    op === "transfer" ? { to: principal(args?.to) }
      : op === "approve" ? { spender: principal(args?.spender) }
        : { owner: principal(args?.owner), to: principal(args?.to) };
  return {
    input: { ...parties, amount: u64Json(amount) },
    display: {
      standard: "DRC20",
      op,
      ...parties,
      valueUnits: amount.toString(),
      ...(op === "approve" ? { isMax: amount === U64_MAX } : {}),
    },
  };
}

/** Options for creating a DRC20 helper facade. */
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

/** DRC20 helper facade with typed reads, tx builders, and writes. */
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

/** Wrap an existing contract facade as a DRC20 helper. */
export function asDrc20(contract: DuskContract): Drc20Contract {
  const build = (facet: DuskContract["tx"] | DuskContract["write"], op: Drc20Op, args: unknown, overrides?: any) => {
    const { input, display } = drc20Call(op, args);
    return facet[op]!(input, { ...(overrides ?? {}), display: mergeDisplay(display, overrides?.display) });
  };
  return {
    contract,
    read: {
      name: () => contract.call["name"]!() as Promise<string>,
      symbol: () => contract.call["symbol"]!() as Promise<string>,
      decimals: async () => Number(await (contract.call["decimals"]!() as Promise<any>)),
      totalSupply: async (callOpts) => String(await contract.call["total_supply"]!(null, callOpts)),
      balanceOf: async (args, callOpts) =>
        String(await contract.call["balance_of"]!({ account: principal(args?.account) }, callOpts)),
      allowance: async (args, callOpts) =>
        String(await contract.call["allowance"]!(
          { owner: principal(args?.owner), spender: principal(args?.spender) }, callOpts)),
    },
    tx: {
      transfer: async (args, overrides) => await build(contract.tx, "transfer", args, overrides),
      approve: async (args, overrides) => await build(contract.tx, "approve", args, overrides),
      transferFrom: async (args, overrides) => await build(contract.tx, "transfer_from", args, overrides),
    },
    write: {
      transfer: async (args, overrides) => await build(contract.write, "transfer", args, overrides),
      approve: async (args, overrides) => await build(contract.write, "approve", args, overrides),
      transferFrom: async (args, overrides) => await build(contract.write, "transfer_from", args, overrides),
    },
  };
}

/** Create a DRC20 helper from contract and data-driver options. */
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
