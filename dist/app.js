import { createDuskWallet, DuskWallet } from "./wallet.js";
import { createDuskNodeClient } from "./node.js";
import { fetchWasmDataDriver } from "./driver.js";
import { ensureChain } from "./ensureChain.js";
import { normalizeBaseUrl, compact } from "./internal/normalize.js";
import { toTxWaitReceipt } from "./internal/tx.js";
import { createDuskContract, } from "./contract.js";
// ------------------------------
// Internals
// ------------------------------
// Prefer the canonical subdomain format used across environments.
// (e.g. https://testnet.nodes.dusk.network, https://devnet.nodes.dusk.network)
const DEFAULT_FALLBACK_NODE_URL = "https://testnet.nodes.dusk.network";
function isHex32Bytes(id) {
    const s = String(id || "").trim();
    const hex = s.toLowerCase().startsWith("0x") ? s.slice(2) : s;
    return /^[0-9a-f]{64}$/.test(hex);
}
function validateContractPreset(name, c) {
    if (!c || typeof c !== "object") {
        throw new Error(`contracts.${name} must be an object`);
    }
    const id = String(c.contractId || "").trim();
    if (!isHex32Bytes(id)) {
        throw new Error(`contracts.${name}.contractId must be a 32-byte hex string (0x + 64 hex chars)`);
    }
    const driverUrl = String(c.driverUrl || "").trim();
    if (!driverUrl) {
        throw new Error(`contracts.${name}.driverUrl is required`);
    }
    // Optional: ensure methodSigs is a plain string map (helps avoid odd runtime merges).
    if (c.methodSigs !== undefined) {
        const m = c.methodSigs;
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
function pickTxOverrides(src) {
    return compact({
        to: src?.to,
        amount: src?.amount,
        deposit: src?.deposit,
        gas: src?.gas,
        display: src?.display,
    });
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
export function createDuskApp(opts = {}) {
    const wallet = opts.wallet instanceof DuskWallet ? opts.wallet : createDuskWallet(opts.wallet);
    const nodeUrl = () => {
        const fromWallet = wallet.state.node?.nodeUrl;
        return normalizeBaseUrl(String(fromWallet || opts.nodeUrl || DEFAULT_FALLBACK_NODE_URL));
    };
    const node = createDuskNodeClient({ baseUrl: nodeUrl });
    const contracts = { ...(opts.contracts ?? {}) };
    // Validate presets early so users get clear errors at init-time, not at the
    // first contract call.
    for (const [name, c] of Object.entries(contracts)) {
        validateContractPreset(name, c);
    }
    const driverCache = new Map();
    const driver = async (driverUrl) => {
        const url = String(driverUrl || "").trim();
        if (!url)
            throw new Error("driverUrl is required");
        if (opts.disableDriverCache)
            return await fetchWasmDataDriver(url);
        const existing = driverCache.get(url);
        if (existing)
            return await existing;
        const p = fetchWasmDataDriver(url);
        driverCache.set(url, p);
        try {
            return await p;
        }
        catch (e) {
            driverCache.delete(url);
            throw e;
        }
    };
    // Cache per-preset contract facades so repeated calls like `dusk.contract("foo")`
    // don't rebuild proxies.
    const presetContractCache = new Map();
    const presetKey = (cfg, chain, autoConnect) => {
        const cid = String(cfg.contractId || "");
        const drv = String(cfg.driverUrl || "");
        const name = String(cfg.name || "");
        const ch = chain?.chainId ? String(chain.chainId) : "";
        const nu = chain?.nodeUrl ? normalizeBaseUrl(String(chain.nodeUrl)) : "";
        return [cid, drv, name, ch, nu, autoConnect ? "1" : "0"].join("|");
    };
    const buildFacade = (cfg, chain, autoConnect) => {
        const o = compact({
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
    const contract = (presetOrOpts) => {
        if (typeof presetOrOpts === "string") {
            const presetName = presetOrOpts;
            const cfg = contracts[presetName];
            if (!cfg)
                throw new Error(`Unknown contract preset: ${String(presetOrOpts)}`);
            const chain = opts.chain;
            const autoConnect = opts.autoConnect ?? true;
            const key = presetKey(cfg, chain, autoConnect);
            const cached = presetContractCache.get(presetName);
            if (cached && cached.key === key)
                return cached.value;
            const ct = buildFacade(cfg, chain, autoConnect);
            presetContractCache.set(presetName, { key, value: ct });
            return ct;
        }
        const cfg = presetOrOpts;
        if (!cfg)
            throw new Error("contract config is required");
        // Inline config: validate the basics so errors are actionable.
        const id = String(cfg.contractId || "").trim();
        if (!isHex32Bytes(id)) {
            throw new Error("contract.contractId must be a 32-byte hex string (0x + 64 hex chars)");
        }
        const drv = String(cfg.driverUrl || "").trim();
        if (!drv)
            throw new Error("contract.driverUrl is required");
        const chain = cfg.chain ?? opts.chain;
        const autoConnect = cfg.autoConnect ?? opts.autoConnect ?? true;
        return buildFacade(cfg, chain, autoConnect);
    };
    const readContract = async ({ contract: c, functionName, args, options }) => {
        const ct = contract(c);
        return await ct.call[String(functionName)](args, options);
    };
    const prepareContractCall = async (params) => {
        const ct = contract(params.contract);
        const overrides = pickTxOverrides(params);
        return (await ct.tx[String(params.functionName)](params.args, overrides));
    };
    const writeContract = async (params) => {
        const ct = contract(params.contract);
        const overrides = pickTxOverrides(params);
        const writeOpts = compact({
            ...overrides,
            autoConnect: params.autoConnect,
            chain: params.chain,
        });
        return await ct.write[String(params.functionName)](params.args, writeOpts);
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
        waitForTx: (hash, options) => node.waitForTxExecuted(hash, options),
        waitForTxReceipt: async (hash, options) => {
            // Best-effort: treat RUES transport failures like a timeout receipt.
            let ev = null;
            let waitErr = null;
            try {
                ev = await node.waitForTxExecuted(hash, compact({ timeoutMs: options?.timeoutMs, signal: options?.signal }));
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
            return receipt;
        },
        ensureChain: (target, o) => ensureChain(wallet, target, o),
        driver,
        contract,
        readContract,
        prepareContractCall,
        writeContract,
        contracts,
    };
}
//# sourceMappingURL=app.js.map