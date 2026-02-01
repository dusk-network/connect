import type {
  SendTransactionParams,
  SwitchChainParams,
  TxHandle,
  TxWaitReceipt,
  WaitForTxOptions,
  DuskWalletState,
} from "./types.js";

import type { DuskWalletOptions } from "./wallet.js";
import type { DuskDataDriver } from "./driver.js";
import type { ContractCallOptions } from "./node.js";

import { createDuskWallet, DuskWallet } from "./wallet.js";
import { createDuskNodeClient } from "./node.js";
import { fetchWasmDataDriver } from "./driver.js";
import { ensureChain, type EnsureChainOptions } from "./ensureChain.js";
import { normalizeBaseUrl, compact } from "./internal/normalize.js";
import { toTxWaitReceipt } from "./internal/tx.js";
import {
  createDuskContract,
  type DuskContract,
  type DuskContractTxOverrides,
  type DuskContractWriteOptions,
} from "./contract.js";

// ------------------------------
// Types
// ------------------------------

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

export type PreparedContractCall = Omit<Extract<SendTransactionParams, { kind: "contract_call" }>, "kind">;

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
  contract(
    presetOrOpts:
      | string
      | (DuskAppContract & {
          /** Optional override for this facade only */
          chain?: SwitchChainParams;
          /** Optional override for this facade only */
          autoConnect?: boolean;
        })
  ): DuskContract;

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
  waitForTx(hash: string, options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<any | null>;

  /**
   * Wait until a tx is executed and return a small receipt-like object.
   *
   * This is the ergonomic version of `waitForTx()` (which returns the raw event).
   */
  waitForTxReceipt(hash: string, options?: WaitForTxOptions): Promise<TxWaitReceipt>;

  /** Expose presets (if any) */
  contracts: Record<string, DuskAppContract>;
};

// ------------------------------
// Internals
// ------------------------------

// Prefer the canonical subdomain format used across environments.
// (e.g. https://testnet.nodes.dusk.network, https://devnet.nodes.dusk.network)
const DEFAULT_FALLBACK_NODE_URL = "https://testnet.nodes.dusk.network";

function isHex32Bytes(id: string): boolean {
  const s = String(id || "").trim();
  const hex = s.toLowerCase().startsWith("0x") ? s.slice(2) : s;
  return /^[0-9a-f]{64}$/.test(hex);
}

function validateContractPreset(name: string, c: DuskAppContract): void {
  if (!c || typeof c !== "object") {
    throw new Error(`contracts.${name} must be an object`);
  }

  const id = String((c as any).contractId || "").trim();
  if (!isHex32Bytes(id)) {
    throw new Error(
      `contracts.${name}.contractId must be a 32-byte hex string (0x + 64 hex chars)`
    );
  }

  const driverUrl = String((c as any).driverUrl || "").trim();
  if (!driverUrl) {
    throw new Error(`contracts.${name}.driverUrl is required`);
  }

  // Optional: ensure methodSigs is a plain string map (helps avoid odd runtime merges).
  if ((c as any).methodSigs !== undefined) {
    const m = (c as any).methodSigs;
    if (!m || typeof m !== "object" || Array.isArray(m)) {
      throw new Error(`contracts.${name}.methodSigs must be a record of strings`);
    }
    for (const [k, v] of Object.entries(m)) {
      if (typeof k !== "string" || typeof v !== "string") {
        throw new Error(`contracts.${name}.methodSigs must map fnName -> signature string`);
      }
    }
  }
}

function pickTxOverrides(src: any): DuskContractTxOverrides {
  return compact({
    to: src?.to,
    amount: src?.amount,
    deposit: src?.deposit,
    gas: src?.gas,
    display: src?.display,
  }) as DuskContractTxOverrides;
}

// ------------------------------
// Public API
// ------------------------------

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
export function createDuskApp(opts: DuskAppOptions = {}): DuskApp {
  const wallet = opts.wallet instanceof DuskWallet ? opts.wallet : createDuskWallet(opts.wallet as DuskWalletOptions);

  const nodeUrl = () => {
    const fromWallet = wallet.state.node?.nodeUrl;
    return normalizeBaseUrl(String(fromWallet || opts.nodeUrl || DEFAULT_FALLBACK_NODE_URL));
  };

  const node = createDuskNodeClient({ baseUrl: nodeUrl });

  const contracts: Record<string, DuskAppContract> = { ...(opts.contracts ?? {}) };

  // Validate presets early so users get clear errors at init-time, not at the
  // first contract call.
  for (const [name, c] of Object.entries(contracts)) {
    validateContractPreset(name, c);
  }

  const driverCache = new Map<string, Promise<DuskDataDriver>>();
  const driver = async (driverUrl: string): Promise<DuskDataDriver> => {
    const url = String(driverUrl || "").trim();
    if (!url) throw new Error("driverUrl is required");

    if (opts.disableDriverCache) return await fetchWasmDataDriver(url);

    const existing = driverCache.get(url);
    if (existing) return await existing;

    const p = fetchWasmDataDriver(url);
    driverCache.set(url, p);
    try {
      return await p;
    } catch (e) {
      driverCache.delete(url);
      throw e;
    }
  };

  // Cache per-preset contract facades so repeated calls like `dusk.contract("foo")`
  // don't rebuild proxies.
  const presetContractCache = new Map<string, { key: string; value: DuskContract }>();
  const presetKey = (cfg: DuskAppContract, chain: SwitchChainParams | undefined, autoConnect: boolean) => {
    const cid = String(cfg.contractId || "");
    const drv = String(cfg.driverUrl || "");
    const name = String(cfg.name || "");
    const ch = chain?.chainId ? String(chain.chainId) : "";
    const nu = chain?.nodeUrl ? normalizeBaseUrl(String(chain.nodeUrl)) : "";
    return [cid, drv, name, ch, nu, autoConnect ? "1" : "0"].join("|");
  };

  const buildFacade = (cfg: DuskAppContract, chain: SwitchChainParams | undefined, autoConnect: boolean): DuskContract => {
    const o: any = compact({
      contractId: cfg.contractId,
      driver: driver(cfg.driverUrl),
      node,
      wallet,
      autoConnect,
      chain,
      name: cfg.name,
      methodSigs: cfg.methodSigs,
      defaultTx: cfg.defaultTx,
    });

    return createDuskContract(o);
  };

  const contract: DuskApp["contract"] = (presetOrOpts) => {
    if (typeof presetOrOpts === "string") {
      const presetName = presetOrOpts;
      const cfg = contracts[presetName];
      if (!cfg) throw new Error(`Unknown contract preset: ${String(presetOrOpts)}`);

      const chain = opts.chain;
      const autoConnect = opts.autoConnect ?? true;
      const key = presetKey(cfg, chain, autoConnect);
      const cached = presetContractCache.get(presetName);
      if (cached && cached.key === key) return cached.value;

      const ct = buildFacade(cfg, chain, autoConnect);
      presetContractCache.set(presetName, { key, value: ct });
      return ct;
    }

    const cfg: any = presetOrOpts;
    if (!cfg) throw new Error("contract config is required");

    // Inline config: validate the basics so errors are actionable.
    const id = String(cfg.contractId || "").trim();
    if (!isHex32Bytes(id)) {
      throw new Error("contract.contractId must be a 32-byte hex string (0x + 64 hex chars)");
    }
    const drv = String(cfg.driverUrl || "").trim();
    if (!drv) throw new Error("contract.driverUrl is required");

    const chain = cfg.chain ?? opts.chain;
    const autoConnect = cfg.autoConnect ?? opts.autoConnect ?? true;

    return buildFacade(cfg, chain, autoConnect);
  };

  const readContract: DuskApp["readContract"] = async ({ contract: c, functionName, args, options }) => {
    const ct = contract(c as any);
    return await (ct.call as any)[String(functionName)](args, options);
  };

  const prepareContractCall: DuskApp["prepareContractCall"] = async (params) => {
    const ct = contract(params.contract as any);
    const overrides = pickTxOverrides(params);
    return (await (ct.tx as any)[String(params.functionName)](params.args, overrides)) as PreparedContractCall;
  };

  const writeContract: DuskApp["writeContract"] = async (params) => {
    const ct = contract(params.contract as any);
    const overrides = pickTxOverrides(params);

    const writeOpts = compact({
      ...overrides,
      autoConnect: params.autoConnect,
      chain: params.chain,
    }) as DuskContractWriteOptions;

    return await (ct.write as any)[String(params.functionName)](params.args, writeOpts);
  };

  return {
    wallet,
    get state() {
      return wallet.state;
    },
    subscribe: wallet.subscribe.bind(wallet),
    connect: wallet.connect.bind(wallet),
    disconnect: wallet.disconnect.bind(wallet),
    switchChain: wallet.switchChain.bind(wallet),
    ready: () => wallet.ready(),
    nodeUrl,
    waitForTx: (hash: string, options?: { timeoutMs?: number; signal?: AbortSignal }) =>
      node.waitForTxExecuted(hash, options),
    waitForTxReceipt: async (hash: string, options?: WaitForTxOptions): Promise<TxWaitReceipt> => {
      // Best-effort: treat RUES transport failures like a timeout receipt.
      let ev: any = null;
      let waitErr: unknown = null;
      try {
        ev = await node.waitForTxExecuted(hash, compact({ timeoutMs: options?.timeoutMs, signal: options?.signal }));
      } catch (e) {
        // Preserve abort semantics.
        if (options?.signal?.aborted) throw e;
        waitErr = e;
        ev = null;
      }

      const receipt = toTxWaitReceipt(hash, ev);
      if (waitErr && receipt.status === "timeout") {
        const msg = waitErr instanceof Error ? waitErr.message : String(waitErr);
        receipt.error = `Unable to track tx execution: ${msg}`;
      }
      return receipt;
    },
    ensureChain: (target: SwitchChainParams, o?: EnsureChainOptions) => ensureChain(wallet, target, o),
    driver,
    contract,
    readContract,
    prepareContractCall,
    writeContract,
    contracts,
  };
}
