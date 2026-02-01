import type {
  AccountId,
  Gas,
  LuxString,
  SwitchChainParams,
  TxHandle,
  TxStatusUpdate,
  TxWaitReceipt,
  WaitForTxOptions,
} from "./types.js";
import type { DuskWallet } from "./wallet.js";
import type { DuskDataDriver } from "./driver.js";
import type { ContractCallOptions, DuskNodeClient } from "./node.js";

import { bytesToHex, hexToBytes } from "./bytes.js";
import { ensureChain } from "./ensureChain.js";
import { compact } from "./internal/normalize.js";
import { toTxWaitReceipt } from "./internal/tx.js";

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

function jsonWithBigInts(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
}

function normalizeContractId(input: string | Uint8Array | number[]): { idHexNo0x: string; idHex0x: string } {
  const bytes =
    typeof input === "string"
      ? hexToBytes(input)
      : input instanceof Uint8Array
      ? input
      : new Uint8Array(input);

  if (bytes.length !== 32) {
    throw new TypeError("contractId must be 32 bytes (0x + 64 hex chars)");
  }

  const idHexNo0x = bytesToHex(bytes).toLowerCase();
  return { idHexNo0x, idHex0x: "0x" + idHexNo0x };
}

function buildDisplay(
  fnName: string,
  opts: { name?: string; methodSigs?: Record<string, string> },
  userDisplay?: unknown
): unknown {
  const base: any = {
    ...(opts.name ? { contractName: opts.name } : {}),
    methodSig: opts.methodSigs?.[fnName] ?? fnName,
  };

  if (userDisplay && typeof userDisplay === "object") return { ...base, ...(userDisplay as any) };
  if (userDisplay == null) return base;
  return { ...base, display: userDisplay };
}

function createFnProxy<T extends Record<string, any>>(factory: (fnName: string) => any): T {
  return new Proxy(
    {},
    {
      get: (_t, prop) => factory(String(prop)),
    }
  ) as any;
}

export function createDuskContract(opts: CreateDuskContractOptions): DuskContract {
  const { idHex0x, idHexNo0x } = normalizeContractId(opts.contractId);
  const driverPromise = Promise.resolve(opts.driver);
  const displayMeta = compact({
    name: opts.name,
    methodSigs: opts.methodSigs,
  }) as { name?: string; methodSigs?: Record<string, string> };

  const encode = async (fnName: string, args?: unknown): Promise<Uint8Array> => {
    const driver = await driverPromise;
    const json = args === undefined || args === null ? "null" : jsonWithBigInts(args);
    return driver.encodeInputFn(String(fnName), json);
  };

  const schema = async () => {
    const driver = await driverPromise;
    return driver.getSchema?.();
  };

  const version = async () => {
    const driver = await driverPromise;
    return driver.getVersion?.();
  };

  const call = createFnProxy<DuskContract["call"]>((fnName) => {
    return async (args?: unknown, callOpts?: ContractCallOptions) => {
      if (!opts.node) throw new Error("contract.call requires a node client");

      const input = await encode(fnName, args);
      const outBytes = await opts.node.contractCall(idHexNo0x, fnName, input, callOpts);

      const driver = await driverPromise;
      return driver.decodeOutputFn(String(fnName), outBytes);
    };
  });

  const tx = createFnProxy<DuskContract["tx"]>((fnName) => {
    return async (args?: unknown, overrides?: DuskContractTxOverrides) => {
      const input = await encode(fnName, args);
      const fnArgs = "0x" + bytesToHex(input);

      const merged: any = {
        ...(opts.defaultTx ?? {}),
        ...(overrides ?? {}),
        contractId: idHex0x,
        fnName,
        fnArgs,
      };

      // display merge
      const userDisplay = overrides?.display ?? opts.defaultTx?.display;
      merged.display = buildDisplay(fnName, displayMeta, userDisplay);

      return merged;
    };
  });

  const write = createFnProxy<DuskContract["write"]>((fnName) => {
    return async (args?: unknown, writeOpts?: DuskContractWriteOptions): Promise<TxHandle> => {
      const wallet = opts.wallet;
      if (!wallet) throw new Error("contract.write requires a wallet");

      const autoConnect = writeOpts?.autoConnect ?? opts.autoConnect ?? true;
      const chainTarget = writeOpts?.chain ?? opts.chain;

      if (autoConnect && !wallet.state.authorized) {
        await wallet.connect();
      }

      if (chainTarget) {
        await ensureChain(wallet, chainTarget);
      }

      // `writeOpts` can include non-tx fields (autoConnect/chain). Strip them.
      const { autoConnect: _ac, chain: _chain, ...txOverrides } = (writeOpts ?? {}) as any;
      const txParams = await (tx as any)[fnName](args, txOverrides);

      const submitted = await wallet.sendContractCall(txParams);
      const hash = String(submitted?.hash ?? "");

      // Tx lifecycle notifications (best-effort).
      let currentStatus: TxStatusUpdate = {
        status: "submitted",
        hash,
        nonce: String((submitted as any)?.nonce ?? ""),
      };

      const listeners = new Set<(u: TxStatusUpdate) => void>();

      const emit = () => {
        for (const fn of listeners) {
          try {
            fn(currentStatus);
          } catch {
            // Ignore handler errors to avoid breaking tx flow.
          }
        }
      };

      const setStatus = (next: TxStatusUpdate) => {
        // Avoid duplicate notifications when status doesn't change.
        if (currentStatus.status === next.status) {
          // `submitted` carries nonce, so allow refresh if it changed.
          if (next.status === "submitted") {
            const prevNonce = (currentStatus as any).nonce;
            const nextNonce = (next as any).nonce;
            if (prevNonce === nextNonce) return;
          } else {
            return;
          }
        }
        currentStatus = next;
        emit();
      };

      const onStatus: TxHandle["onStatus"] = (handler) => {
        const fn = handler as any;
        listeners.add(fn);
        // Call immediately with current status so UIs don't miss "submitted".
        try {
          fn(currentStatus);
        } catch {
          // ignore
        }
        return () => {
          listeners.delete(fn);
        };
      };

      // Attach a lightweight `wait()` helper when a node client is available.
      let waited: Promise<TxWaitReceipt> | null = null;

      const wait: TxHandle["wait"] = async (options?: WaitForTxOptions) => {
        if (waited) return waited;

        waited = (async () => {
          if (!opts.node) {
            throw new Error("tx.wait requires a node client (pass `node` when creating the contract facade)");
          }

          // Only transition to executing once.
          if (currentStatus.status === "submitted") {
            setStatus({ status: "executing", hash });
          }

          // Best-effort: treat RUES transport failures like a timeout receipt.
          let ev: any = null;
          let waitErr: unknown = null;
          try {
            ev = await opts.node.waitForTxExecuted(
              hash,
              compact({ timeoutMs: options?.timeoutMs, signal: options?.signal })
            );
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

          setStatus({ status: receipt.status, hash, receipt });
          return receipt;
        })();

        return waited;
      };

      const waitExecuted: TxHandle["waitExecuted"] = (options?: WaitForTxOptions) => wait(options);

      return Object.assign(submitted, { wait, waitExecuted, onStatus });
    };
  });

  return {
    id: idHex0x,
    schema,
    version,
    encode,
    call,
    tx,
    write,
  };
}
