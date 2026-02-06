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

export type Drc721BalanceOf = { account: DrcAccount };
export type Drc721OwnerOf = { token_id: LuxString };
export type Drc721TokenUri = { token_id: LuxString };
export type Drc721GetApproved = { token_id: LuxString };
export type Drc721IsApprovedForAll = { owner: DrcAccount; operator: DrcAccount };

export type Drc721ApproveCall = { approved: DrcAccount; token_id: LuxString };
export type Drc721SetApprovalForAllCall = { operator: DrcAccount; approved: boolean };
export type Drc721TransferFromCall = { from: DrcAccount; to: DrcAccount; token_id: LuxString };

export const DRC721_METHOD_SIGS: Record<string, string> = {
  // Views
  name: "name()",
  symbol: "symbol()",
  base_uri: "base_uri()",
  token_uri: "token_uri(token_id: u64)",
  total_supply: "total_supply()",
  balance_of: "balance_of(account: Account)",
  owner_of: "owner_of(token_id: u64)",
  get_approved: "get_approved(token_id: u64)",
  is_approved_for_all: "is_approved_for_all(owner: Account, operator: Account)",
  // State-changing
  approve: "approve(approved: Account, token_id: u64)",
  set_approval_for_all: "set_approval_for_all(operator: Account, approved: bool)",
  transfer_from: "transfer_from(from: Account, to: Account, token_id: u64)",
};

function mergeDisplay(base: any, extra: unknown): unknown {
  if (extra && typeof extra === "object") return { ...base, ...(extra as any) };
  if (extra == null) return base;
  return { ...base, display: extra };
}

function buildDrc721Display(op: string, args: unknown): any {
  const a: any = args && typeof args === "object" ? (args as any) : {};
  return {
    standard: "DRC721",
    op,
    ...(op === "approve" ? { approved: a.approved, tokenId: String(a.token_id ?? "") } : {}),
    ...(op === "set_approval_for_all" ? { operator: a.operator, approved: Boolean(a.approved) } : {}),
    ...(op === "transfer_from" ? { from: a.from, to: a.to, tokenId: String(a.token_id ?? "") } : {}),
  };
}

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

export function asDrc721(contract: DuskContract): Drc721Contract {
  return {
    contract,
    read: {
      name: () => contract.call["name"]!() as Promise<string>,
      symbol: () => contract.call["symbol"]!() as Promise<string>,
      baseUri: () => contract.call["base_uri"]!() as Promise<string>,
      totalSupply: async (callOpts) => String(await contract.call["total_supply"]!(null, callOpts)),
      balanceOf: async (args, callOpts) => String(await contract.call["balance_of"]!(args, callOpts)),
      ownerOf: async (args, callOpts) => await contract.call["owner_of"]!(args, callOpts),
      tokenUri: async (args, callOpts) => String(await contract.call["token_uri"]!(args, callOpts)),
      getApproved: async (args, callOpts) => await contract.call["get_approved"]!(args, callOpts),
      isApprovedForAll: async (args, callOpts) => Boolean(await contract.call["is_approved_for_all"]!(args, callOpts)),
    },
    tx: {
      approve: async (args, overrides) =>
        await contract.tx["approve"]!(args, {
          ...(overrides ?? {}),
          display: mergeDisplay(buildDrc721Display("approve", args), overrides?.display),
        }),
      setApprovalForAll: async (args, overrides) =>
        await contract.tx["set_approval_for_all"]!(args, {
          ...(overrides ?? {}),
          display: mergeDisplay(buildDrc721Display("set_approval_for_all", args), overrides?.display),
        }),
      transferFrom: async (args, overrides) =>
        await contract.tx["transfer_from"]!(args, {
          ...(overrides ?? {}),
          display: mergeDisplay(buildDrc721Display("transfer_from", args), overrides?.display),
        }),
    },
    write: {
      approve: async (args, overrides) =>
        await contract.write["approve"]!(args, {
          ...(overrides ?? {}),
          display: mergeDisplay(buildDrc721Display("approve", args), overrides?.display),
        }),
      setApprovalForAll: async (args, overrides) =>
        await contract.write["set_approval_for_all"]!(args, {
          ...(overrides ?? {}),
          display: mergeDisplay(buildDrc721Display("set_approval_for_all", args), overrides?.display),
        }),
      transferFrom: async (args, overrides) =>
        await contract.write["transfer_from"]!(args, {
          ...(overrides ?? {}),
          display: mergeDisplay(buildDrc721Display("transfer_from", args), overrides?.display),
        }),
    },
  };
}

export function createDrc721(opts: CreateDrc721Options): Drc721Contract {
  const driver = opts.driver ?? (opts.driverUrl ? fetchWasmDataDriver(opts.driverUrl) : null);
  if (!driver) throw new Error("createDrc721: driver or driverUrl is required");

  const contract = createDuskContract({
    ...opts,
    driver,
    name: opts.name ?? "DRC721",
    methodSigs: { ...DRC721_METHOD_SIGS, ...(opts.methodSigs ?? {}) },
  });

  return asDrc721(contract);
}
