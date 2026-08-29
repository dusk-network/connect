import type {
  AccountId,
  Gas,
  LuxString,
  PrivacyMode,
  SwitchChainParams,
  TxHandle,
  TxOrigin,
  TxStatusUpdate,
  TxWaitReceipt,
  WaitForTxOptions,
} from "./types.js";
import type { DuskWallet } from "./wallet.js";
import type { DuskDataDriver } from "./driver.js";
import type { ContractCallOptions, DuskNodeClient } from "./node.js";

import { bytesToHex } from "./bytes.js";
import { DuskTxTrackingUnavailableError, DuskWalletProviderChangedError } from "./errors.js";
import { ensureChain } from "./ensureChain.js";
import { normalizeContractId0x } from "./internal/contractId.js";
import { compact, normalizeBaseUrl, normalizeCaip2ChainId } from "./internal/normalize.js";
import { waitForTxReceipt } from "./internal/tx.js";

/** Optional wallet transaction fields for a contract call. */
export type DuskContractTxOverrides = {
  to?: AccountId;
  /** Choose Moonlight (public) or Phoenix (shielded) for contract calls. */
  privacy?: PrivacyMode;
  amount?: LuxString;
  deposit?: LuxString;
  gas?: Gas;
  /** Extra decoded info shown to the user in the wallet approval UI. */
  display?: unknown;
};

/** Options for immediately submitting a contract call through the wallet. */
export type DuskContractWriteOptions = DuskContractTxOverrides & {
  /** If true, call wallet.connect() when not authorized. Default: true */
  autoConnect?: boolean;
  /** Optional chain target enforced before sending (uses ensureChain) */
  chain?: SwitchChainParams;
};

/** Options for creating a data-driver-backed contract facade. */
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

/** Proxy-based contract facade with read, tx-build, and write helpers. */
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
      get: (target, prop, receiver) => {
        if (prop === "then") return undefined;
        if (typeof prop === "symbol") return Reflect.get(target, prop, receiver);
        return factory(prop);
      },
    }
  ) as any;
}

/** Create a data-driver-backed contract facade. */
export function createDuskContract(opts: CreateDuskContractOptions): DuskContract {
  const idHex0x = normalizeContractId0x(opts.contractId);
  const idHexNo0x = idHex0x.slice(2);
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

      const privacy = String(merged.privacy ?? "").trim();
      if (privacy !== "public" && privacy !== "shielded") {
        throw new TypeError('privacy is required ("public" or "shielded")');
      }
      merged.privacy = privacy;

      return merged;
    };
  });

  const write = createFnProxy<DuskContract["write"]>((fnName) => {
    return async (args?: unknown, writeOpts?: DuskContractWriteOptions): Promise<TxHandle> => {
      const wallet = opts.wallet;
      if (!wallet) throw new Error("contract.write requires a wallet");

      const autoConnect = writeOpts?.autoConnect ?? opts.autoConnect ?? true;
      const chainTarget = writeOpts?.chain ?? opts.chain;
      let provider = wallet.provider;
      if (!provider) {
        await wallet.ready?.();
        provider = wallet.provider;
      }
      const selection = { provider, epoch: wallet.selectionEpoch };
      const assertSelection = () => {
        if (wallet.provider !== selection.provider || wallet.selectionEpoch !== selection.epoch) {
          throw new DuskWalletProviderChangedError();
        }
      };

      if (!wallet.state.node) {
        await wallet.ready?.();
        assertSelection();
      }

      if (autoConnect && !wallet.state.authorized) {
        await wallet.connect();
        assertSelection();
      }

      if (chainTarget) {
        await ensureChain(wallet, chainTarget, { selection });
      }

      // `writeOpts` can include non-tx fields (autoConnect/chain). Strip them.
      const { autoConnect: _ac, chain: _chain, ...txOverrides } = (writeOpts ?? {}) as any;
      const txParams = await (tx as any)[fnName](args, txOverrides);
      assertSelection();

      const walletNode = wallet.state.node;
      const walletNodeUrl = walletNode?.chainId === wallet.state.chainId ? walletNode.nodeUrl : "";
      const nodeUrl = walletNodeUrl ? normalizeBaseUrl(walletNodeUrl) : "";
      const targetConfirmed =
        (!chainTarget?.chainId ||
          normalizeCaip2ChainId(chainTarget.chainId) === normalizeCaip2ChainId(wallet.state.chainId ?? "")) &&
        (!chainTarget?.nodeUrl || normalizeBaseUrl(chainTarget.nodeUrl) === nodeUrl);
      const origin: TxOrigin = Object.freeze({
        providerId: wallet.state.providerId ?? null,
        selectionEpoch: selection.epoch,
        networkEpoch: wallet.networkEpoch ?? 0,
        chainId: wallet.state.chainId ?? null,
        nodeUrl: targetConfirmed ? nodeUrl : "",
      });
      const nodeMatchesOrigin = Boolean(
        origin.nodeUrl && opts.node?.getBaseUrl?.() === origin.nodeUrl
      );
      const trackingNode = nodeMatchesOrigin ? opts.node?.pin?.(origin.nodeUrl) ?? opts.node : opts.node;
      const submitted = await wallet.sendContractCall(txParams);
      const submissionContextChanged =
        wallet.provider !== selection.provider ||
        wallet.selectionEpoch !== selection.epoch ||
        (wallet.networkEpoch ?? 0) !== origin.networkEpoch;
      const hash = String(submitted?.hash ?? "");
      const submittedNonce = String((submitted as any)?.nonce ?? "");

      // Tx lifecycle notifications (best-effort).
      let currentStatus: TxStatusUpdate = {
        status: "submitted",
        hash,
        nonce: submittedNonce,
      };

      const listeners = new Set<(u: TxStatusUpdate) => void>();

      const statusQueue: Array<{
        update: TxStatusUpdate;
        listeners: Array<(u: TxStatusUpdate) => void>;
      }> = [];
      let emitting = false;
      const emit = () => {
        statusQueue.push({ update: currentStatus, listeners: [...listeners] });
        if (emitting) return;
        emitting = true;
        try {
          for (let i = 0; i < statusQueue.length; i++) {
            const queued = statusQueue[i]!;
            for (const fn of queued.listeners) {
              if (!listeners.has(fn)) continue;
              try {
                fn(queued.update);
              } catch {
                // Ignore handler errors to avoid breaking tx flow.
              }
            }
          }
        } finally {
          statusQueue.length = 0;
          emitting = false;
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

      // Cache only a definitive execution result. Callers can retry timeouts,
      // aborts, and transport failures with independent wait options.
      let finalReceipt: TxWaitReceipt | null = null;
      let pendingTimeout: TxWaitReceipt | null = null;
      let activeWaits = 0;

      const wait: TxHandle["wait"] = async (options?: WaitForTxOptions) => {
        if (finalReceipt) return finalReceipt;
        if (!trackingNode) {
          throw new Error("tx.wait requires a node client (pass `node` when creating the contract facade)");
        }
        const unpinnedEndpointChanged =
          trackingNode === opts.node && origin.nodeUrl && opts.node!.getBaseUrl() !== origin.nodeUrl;
        if (!nodeMatchesOrigin || submissionContextChanged || unpinnedEndpointChanged) {
          throw new DuskTxTrackingUnavailableError(hash, origin);
        }

        if (currentStatus.status === "submitted" || currentStatus.status === "timeout") {
          setStatus({ status: "executing", hash });
        }

        activeWaits++;
        try {
          const receipt = await waitForTxReceipt(trackingNode, hash, options);
          activeWaits--;
          if (finalReceipt) return finalReceipt;
          if (receipt.status === "timeout" && activeWaits > 0) {
            pendingTimeout = receipt;
            return receipt;
          }
          if (receipt.status === "executed" || receipt.status === "failed") {
            finalReceipt = receipt;
            pendingTimeout = null;
          } else if (receipt.status === "timeout") {
            pendingTimeout = null;
          }
          setStatus({ status: receipt.status, hash, receipt });
          return receipt;
        } catch (error) {
          activeWaits--;
          if (!finalReceipt && activeWaits === 0 && currentStatus.status === "executing") {
            if (pendingTimeout) {
              setStatus({ status: "timeout", hash, receipt: pendingTimeout });
              pendingTimeout = null;
            } else {
              setStatus({ status: "submitted", hash, nonce: submittedNonce });
            }
          }
          throw error;
        }
      };

      const waitExecuted: TxHandle["waitExecuted"] = (options?: WaitForTxOptions) => wait(options);

      return Object.assign(submitted, { origin, wait, waitExecuted, onStatus });
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
