import { bytesToHex, hexToBytes } from "./bytes.js";
import { ensureChain } from "./ensureChain.js";
import { compact } from "./internal/normalize.js";
import { toTxWaitReceipt } from "./internal/tx.js";
function jsonWithBigInts(value) {
    return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
}
function normalizeContractId(input) {
    const bytes = typeof input === "string"
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
function buildDisplay(fnName, opts, userDisplay) {
    const base = {
        ...(opts.name ? { contractName: opts.name } : {}),
        methodSig: opts.methodSigs?.[fnName] ?? fnName,
    };
    if (userDisplay && typeof userDisplay === "object")
        return { ...base, ...userDisplay };
    if (userDisplay == null)
        return base;
    return { ...base, display: userDisplay };
}
function createFnProxy(factory) {
    return new Proxy({}, {
        get: (_t, prop) => factory(String(prop)),
    });
}
export function createDuskContract(opts) {
    const { idHex0x, idHexNo0x } = normalizeContractId(opts.contractId);
    const driverPromise = Promise.resolve(opts.driver);
    const displayMeta = compact({
        name: opts.name,
        methodSigs: opts.methodSigs,
    });
    const encode = async (fnName, args) => {
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
    const call = createFnProxy((fnName) => {
        return async (args, callOpts) => {
            if (!opts.node)
                throw new Error("contract.call requires a node client");
            const input = await encode(fnName, args);
            const outBytes = await opts.node.contractCall(idHexNo0x, fnName, input, callOpts);
            const driver = await driverPromise;
            return driver.decodeOutputFn(String(fnName), outBytes);
        };
    });
    const tx = createFnProxy((fnName) => {
        return async (args, overrides) => {
            const input = await encode(fnName, args);
            const fnArgs = "0x" + bytesToHex(input);
            const merged = {
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
    const write = createFnProxy((fnName) => {
        return async (args, writeOpts) => {
            const wallet = opts.wallet;
            if (!wallet)
                throw new Error("contract.write requires a wallet");
            const autoConnect = writeOpts?.autoConnect ?? opts.autoConnect ?? true;
            const chainTarget = writeOpts?.chain ?? opts.chain;
            if (autoConnect && !wallet.state.authorized) {
                await wallet.connect();
            }
            if (chainTarget) {
                await ensureChain(wallet, chainTarget);
            }
            // `writeOpts` can include non-tx fields (autoConnect/chain). Strip them.
            const { autoConnect: _ac, chain: _chain, ...txOverrides } = (writeOpts ?? {});
            const txParams = await tx[fnName](args, txOverrides);
            const submitted = await wallet.sendContractCall(txParams);
            const hash = String(submitted?.hash ?? "");
            // Tx lifecycle notifications (best-effort).
            let currentStatus = {
                status: "submitted",
                hash,
                nonce: String(submitted?.nonce ?? ""),
            };
            const listeners = new Set();
            const emit = () => {
                for (const fn of listeners) {
                    try {
                        fn(currentStatus);
                    }
                    catch {
                        // Ignore handler errors to avoid breaking tx flow.
                    }
                }
            };
            const setStatus = (next) => {
                // Avoid duplicate notifications when status doesn't change.
                if (currentStatus.status === next.status) {
                    // `submitted` carries nonce, so allow refresh if it changed.
                    if (next.status === "submitted") {
                        const prevNonce = currentStatus.nonce;
                        const nextNonce = next.nonce;
                        if (prevNonce === nextNonce)
                            return;
                    }
                    else {
                        return;
                    }
                }
                currentStatus = next;
                emit();
            };
            const onStatus = (handler) => {
                const fn = handler;
                listeners.add(fn);
                // Call immediately with current status so UIs don't miss "submitted".
                try {
                    fn(currentStatus);
                }
                catch {
                    // ignore
                }
                return () => {
                    listeners.delete(fn);
                };
            };
            // Attach a lightweight `wait()` helper when a node client is available.
            let waited = null;
            const wait = async (options) => {
                if (waited)
                    return waited;
                waited = (async () => {
                    if (!opts.node) {
                        throw new Error("tx.wait requires a node client (pass `node` when creating the contract facade)");
                    }
                    // Only transition to executing once.
                    if (currentStatus.status === "submitted") {
                        setStatus({ status: "executing", hash });
                    }
                    // Best-effort: treat RUES transport failures like a timeout receipt.
                    let ev = null;
                    let waitErr = null;
                    try {
                        ev = await opts.node.waitForTxExecuted(hash, compact({ timeoutMs: options?.timeoutMs, signal: options?.signal }));
                    }
                    catch (e) {
                        // Preserve abort semantics.
                        if (options?.signal?.aborted)
                            throw e;
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
            const waitExecuted = (options) => wait(options);
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
//# sourceMappingURL=contract.js.map