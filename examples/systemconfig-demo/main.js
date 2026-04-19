/**
 * SystemConfig demo (browser dApp)
 * ------------------------------------------------------------
 * - Uses Dusk wallet discovery + explicit provider selection
 * - Uses createDuskApp() + a local WASM data-driver for encode/decode
 * - Reads via contract.call.*
 * - Writes via contract.write.* with tx.onStatus + tx.wait
 *
 * IMPORTANT: reads are NOT polled. Click Refresh to query the node.
 *
 * Node load note:
 * - Refresh (light) keeps the getter list small.
 * - Refresh (full) loads extra fields (more calls) and should be used sparingly.
 */

import { defineDuskConnectButton } from "../../dist/ui.js";
import { createDuskApp, DUSK_CHAIN_PRESETS } from "../../dist/index.js";

defineDuskConnectButton();

const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

const DEFAULTS = {
  network: "devnet",
  nodeUrl: "https://devnet.nodes.dusk.network",
  // cache-bust during dev to avoid stale WASM
  driverUrl: "./public/data_driver.wasm?v=" + Date.now(),
  // placeholder (replace via query params)
  contractId: "0x86842f2a2e5dc93cf09133b3c8f9c691cdaffa93a209e0f93db69a6adcb08689",
};

function getParam(name, fallback) {
  const v = new URLSearchParams(location.search).get(name);
  return v === null || v === "" ? fallback : v;
}

function normalizeNetwork(net) {
  const n = String(net || "").toLowerCase();
  if (n === "mainnet" || n === "devnet" || n === "testnet") return n;
  return DEFAULTS.network;
}

function chainIdForNetwork(net) {
  switch (net) {
    case "mainnet":
      return DUSK_CHAIN_PRESETS.mainnet;
    case "devnet":
      return DUSK_CHAIN_PRESETS.devnet;
    case "testnet":
    default:
      return DUSK_CHAIN_PRESETS.testnet;
  }
}

function isValidHex32(id) {
  return /^0x[0-9a-fA-F]{64}$/.test(id);
}

function isValidHex20(addr) {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

function isValidBytes32Hex(hex) {
  return /^0x[0-9a-fA-F]{64}$/.test(hex);
}

function fmtError(e) {
  if (!e) return "unknown error";
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message || String(e);
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

function setBadge(el, kind, text) {
  el.classList.remove("ok", "warn", "err", "info");
  if (kind) el.classList.add(kind);
  el.textContent = text;
}

function fmtU64(v) {
  // Drivers often serialize u64 as JSON strings to avoid JS float issues.
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "bigint") return v.toString();
  return String(v);
}

function fmtU32(v) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v;
  if (typeof v === "bigint") return v.toString();
  return String(v);
}

function fmtOpt(v) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function bytesToHex(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = "";
  for (let i = 0; i < b.length; i++) out += b[i].toString(16).padStart(2, "0");
  return out;
}

function fmtBytes32(v) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") {
    // Some drivers may already emit 0x... strings.
    if (v.startsWith("0x")) return v;
    return v;
  }
  // Typical shape: number[32]
  if (Array.isArray(v) && v.length === 32) {
    const bytes = new Uint8Array(v.map((n) => Number(n) & 0xff));
    return "0x" + bytesToHex(bytes);
  }
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function safeJson(v) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function hexToBytes32Array(hex) {
  if (!isValidBytes32Hex(hex)) return null;
  const h = hex.slice(2);
  const out = [];
  for (let i = 0; i < 64; i += 2) {
    out.push(parseInt(h.slice(i, i + 2), 16));
  }
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const cfg = {
  network: normalizeNetwork(getParam("network", DEFAULTS.network)),
  nodeUrl: getParam("nodeUrl", DEFAULTS.nodeUrl),
  driverUrl: getParam("driverUrl", DEFAULTS.driverUrl),
  contractId: getParam("contractId", DEFAULTS.contractId),
};

// ------- SDK init -------

const dusk = createDuskApp({
  nodeUrl: cfg.nodeUrl,
  chain: { chainId: chainIdForNetwork(cfg.network) },
  autoConnect: true,
  contracts: {
    sys: {
      name: "SystemConfig",
      contractId: cfg.contractId,
      driverUrl: cfg.driverUrl,
      methodSigs: {
        // common reads
        paused: "paused()",
        gas_limit: "gas_limit()",
        basefee_scalar: "basefee_scalar()",
        blobbasefee_scalar: "blobbasefee_scalar()",
        owner: "owner()",
        version: "version()",

        // additional reads
        l2_chain_id: "l2_chain_id()",
        batch_inbox: "batch_inbox()",
        unsafe_block_signer: "unsafe_block_signer()",
        batcher_hash: "batcher_hash()",
        minimum_gas_limit: "minimum_gas_limit()",
        maximum_gas_limit: "maximum_gas_limit()",
        min_base_fee: "min_base_fee()",
        eip1559_denominator: "eip1559_denominator()",
        eip1559_elasticity: "eip1559_elasticity()",
        operator_fee_scalar: "operator_fee_scalar()",
        operator_fee_constant: "operator_fee_constant()",
        da_footprint_gas_scalar: "da_footprint_gas_scalar()",
        guardian: "guardian()",
        superchain_config: "superchain_config()",
        is_custom_gas_token: "is_custom_gas_token()",
        resource_config: "resource_config()",
        get_addresses: "get_addresses()",

        // writes
        set_gas_limit: "set_gas_limit(u64)",
        set_gas_config_ecotone: "set_gas_config_ecotone((u32,u32))",
        set_batcher_hash_address: "set_batcher_hash_address(address)",
        set_unsafe_block_signer: "set_unsafe_block_signer(address)",
        set_feature: "set_feature((bytes32,bool))",
      },
    },
  },
});

const wallet = dusk.wallet;
const c = dusk.contract("sys");

const connectButton = document.querySelector("dusk-connect-button");
if (connectButton) connectButton.wallet = wallet;

// ------- UI refs -------

const ui = {
  configHint: $("config-hint"),

  inputNetwork: /** @type {HTMLSelectElement} */ ($("input-network")),
  inputNode: /** @type {HTMLInputElement} */ ($("input-node")),
  inputContract: /** @type {HTMLInputElement} */ ($("input-contract")),
  inputDriver: /** @type {HTMLInputElement} */ ($("input-driver")),
  btnApply: /** @type {HTMLButtonElement} */ ($("btn-apply")),

  syncBadge: $("sync-status"),

  vPaused: $("v-paused"),
  vGasLimit: $("v-gas-limit"),
  vBasefeeScalar: $("v-basefee-scalar"),
  vBlobBasefeeScalar: $("v-blobbasefee-scalar"),
  vOwner: $("v-owner"),
  vVersion: $("v-version"),

  fullFieldsWrap: $("full-fields"),
  vL2ChainId: $("v-l2-chain-id"),
  vBatchInbox: $("v-batch-inbox"),
  vUnsafeSigner: $("v-unsafe-signer"),
  vBatcherHash: $("v-batcher-hash"),
  vMinimumGas: $("v-minimum-gas"),
  vMaximumGas: $("v-maximum-gas"),
  vMinBaseFee: $("v-min-base-fee"),
  vEip1559Denom: $("v-eip1559-denom"),
  vEip1559Elast: $("v-eip1559-elast"),
  vOpFeeScalar: $("v-op-fee-scalar"),
  vOpFeeConst: $("v-op-fee-const"),
  vDaScalar: $("v-da-scalar"),
  vGuardian: $("v-guardian"),
  vSuperchain: $("v-superchain"),
  vCustomGas: $("v-custom-gas"),
  vResource: /** @type {HTMLElement} */ ($("v-resource")),
  vAddresses: /** @type {HTMLElement} */ ($("v-addresses")),

  btnRefreshLight: /** @type {HTMLButtonElement} */ ($("btn-refresh-light")),
  btnRefreshFull: /** @type {HTMLButtonElement} */ ($("btn-refresh-full")),

  txBadge: $("tx-status"),
  txLog: /** @type {HTMLElement} */ ($("tx-log")),

  inputGasLimit: /** @type {HTMLInputElement} */ ($("input-gas-limit")),
  btnSetGasLimit: /** @type {HTMLButtonElement} */ ($("btn-set-gas-limit")),

  inputBasefee: /** @type {HTMLInputElement} */ ($("input-basefee")),
  inputBlobBasefee: /** @type {HTMLInputElement} */ ($("input-blobbasefee")),
  btnSetEcotone: /** @type {HTMLButtonElement} */ ($("btn-set-ecotone")),

  inputBatcher: /** @type {HTMLInputElement} */ ($("input-batcher")),
  btnSetBatcher: /** @type {HTMLButtonElement} */ ($("btn-set-batcher")),

  inputUnsafeSigner: /** @type {HTMLInputElement} */ ($("input-unsafe-signer")),
  btnSetUnsafe: /** @type {HTMLButtonElement} */ ($("btn-set-unsafe")),

  inputFeature: /** @type {HTMLInputElement} */ ($("input-feature")),
  selectFeatureEnabled: /** @type {HTMLSelectElement} */ ($("select-feature-enabled")),
  btnSetFeature: /** @type {HTMLButtonElement} */ ($("btn-set-feature")),
};

function log(line) {
  const now = new Date();
  const t = now.toLocaleTimeString();
  ui.txLog.textContent = `[${t}] ${line}\n` + ui.txLog.textContent;
}

// ------- config apply -------

ui.inputNetwork.value = cfg.network;
ui.inputNode.value = cfg.nodeUrl;
ui.inputContract.value = cfg.contractId;
ui.inputDriver.value = cfg.driverUrl;

ui.btnApply.addEventListener("click", () => {
  const next = {
    network: normalizeNetwork(ui.inputNetwork.value),
    nodeUrl: ui.inputNode.value.trim(),
    contractId: ui.inputContract.value.trim(),
    driverUrl: ui.inputDriver.value.trim(),
  };

  const p = new URLSearchParams();
  if (next.network) p.set("network", next.network);
  if (next.nodeUrl) p.set("nodeUrl", next.nodeUrl);
  if (next.contractId) p.set("contractId", next.contractId);
  if (next.driverUrl) p.set("driverUrl", next.driverUrl);

  location.search = "?" + p.toString();
});

// ------- reads (rate-friendly) -------

/** @type {AbortController | null} */
let syncAbort = null;
let syncInFlight = false;

async function readOne(label, fn) {
  try {
    const v = await fn();
    return { ok: true, value: v };
  } catch (e) {
    log(`read ${label} failed: ${fmtError(e)}`);
    return { ok: false, value: null };
  }
}

async function syncLight() {
  if (syncInFlight) {
    try {
      syncAbort?.abort();
    } catch {}
  }
  syncInFlight = true;

  syncAbort = new AbortController();
  const signal = syncAbort.signal;

  ui.btnRefreshLight.disabled = true;
  ui.btnRefreshFull.disabled = true;
  setBadge(ui.syncBadge, "info", "loading");

  // Keep this list small to avoid triggering nodes with many queries.
  const paused = await readOne("paused", () => c.call.paused(undefined, { signal }));
  await sleep(60);
  const gasLimit = await readOne("gas_limit", () => c.call.gas_limit(undefined, { signal }));
  await sleep(60);
  const basefeeScalar = await readOne("basefee_scalar", () =>
    c.call.basefee_scalar(undefined, { signal })
  );
  await sleep(60);
  const blobScalar = await readOne("blobbasefee_scalar", () =>
    c.call.blobbasefee_scalar(undefined, { signal })
  );
  await sleep(60);
  const owner = await readOne("owner", () => c.call.owner(undefined, { signal }));
  await sleep(60);
  const version = await readOne("version", () => c.call.version(undefined, { signal }));

  ui.vPaused.textContent = paused.ok ? String(paused.value) : "—";
  ui.vGasLimit.textContent = gasLimit.ok ? fmtU64(gasLimit.value) : "—";
  ui.vBasefeeScalar.textContent = basefeeScalar.ok ? fmtU32(basefeeScalar.value) : "—";
  ui.vBlobBasefeeScalar.textContent = blobScalar.ok ? fmtU32(blobScalar.value) : "—";
  ui.vOwner.textContent = owner.ok ? fmtOpt(owner.value) : "—";
  ui.vVersion.textContent = version.ok ? String(version.value) : "—";

  setBadge(ui.syncBadge, "ok", "synced");
  ui.btnRefreshLight.disabled = false;
  ui.btnRefreshFull.disabled = false;
  syncInFlight = false;
}

async function syncFull() {
  ui.fullFieldsWrap.classList.remove("hidden");

  if (syncInFlight) {
    try {
      syncAbort?.abort();
    } catch {}
  }
  syncInFlight = true;

  syncAbort = new AbortController();
  const signal = syncAbort.signal;

  ui.btnRefreshLight.disabled = true;
  ui.btnRefreshFull.disabled = true;
  setBadge(ui.syncBadge, "info", "loading (full)");

  // Full sync: still sequential, but does more calls. Use sparingly.
  const paused = await readOne("paused", () => c.call.paused(undefined, { signal }));
  await sleep(60);
  const gasLimit = await readOne("gas_limit", () => c.call.gas_limit(undefined, { signal }));
  await sleep(60);
  const basefeeScalar = await readOne("basefee_scalar", () =>
    c.call.basefee_scalar(undefined, { signal })
  );
  await sleep(60);
  const blobScalar = await readOne("blobbasefee_scalar", () =>
    c.call.blobbasefee_scalar(undefined, { signal })
  );
  await sleep(60);
  const owner = await readOne("owner", () => c.call.owner(undefined, { signal }));
  await sleep(60);
  const version = await readOne("version", () => c.call.version(undefined, { signal }));
  await sleep(60);

  const l2ChainId = await readOne("l2_chain_id", () => c.call.l2_chain_id(undefined, { signal }));
  await sleep(60);
  const batchInbox = await readOne("batch_inbox", () => c.call.batch_inbox(undefined, { signal }));
  await sleep(60);
  const unsafeSigner = await readOne("unsafe_block_signer", () =>
    c.call.unsafe_block_signer(undefined, { signal })
  );
  await sleep(60);
  const batcherHash = await readOne("batcher_hash", () => c.call.batcher_hash(undefined, { signal }));
  await sleep(60);

  const minGas = await readOne("minimum_gas_limit", () =>
    c.call.minimum_gas_limit(undefined, { signal })
  );
  await sleep(60);
  const maxGas = await readOne("maximum_gas_limit", () =>
    c.call.maximum_gas_limit(undefined, { signal })
  );
  await sleep(60);
  const minBaseFee = await readOne("min_base_fee", () => c.call.min_base_fee(undefined, { signal }));
  await sleep(60);

  const eipDenom = await readOne("eip1559_denominator", () =>
    c.call.eip1559_denominator(undefined, { signal })
  );
  await sleep(60);
  const eipElast = await readOne("eip1559_elasticity", () =>
    c.call.eip1559_elasticity(undefined, { signal })
  );
  await sleep(60);
  const opFeeScalar = await readOne("operator_fee_scalar", () =>
    c.call.operator_fee_scalar(undefined, { signal })
  );
  await sleep(60);
  const opFeeConst = await readOne("operator_fee_constant", () =>
    c.call.operator_fee_constant(undefined, { signal })
  );
  await sleep(60);
  const daScalar = await readOne("da_footprint_gas_scalar", () =>
    c.call.da_footprint_gas_scalar(undefined, { signal })
  );
  await sleep(60);

  const guardian = await readOne("guardian", () => c.call.guardian(undefined, { signal }));
  await sleep(60);
  const superchain = await readOne("superchain_config", () =>
    c.call.superchain_config(undefined, { signal })
  );
  await sleep(60);
  const customGas = await readOne("is_custom_gas_token", () =>
    c.call.is_custom_gas_token(undefined, { signal })
  );
  await sleep(60);

  const resource = await readOne("resource_config", () =>
    c.call.resource_config(undefined, { signal })
  );
  await sleep(60);
  const addresses = await readOne("get_addresses", () =>
    c.call.get_addresses(undefined, { signal })
  );

  // Top panel
  ui.vPaused.textContent = paused.ok ? String(paused.value) : "—";
  ui.vGasLimit.textContent = gasLimit.ok ? fmtU64(gasLimit.value) : "—";
  ui.vBasefeeScalar.textContent = basefeeScalar.ok ? fmtU32(basefeeScalar.value) : "—";
  ui.vBlobBasefeeScalar.textContent = blobScalar.ok ? fmtU32(blobScalar.value) : "—";
  ui.vOwner.textContent = owner.ok ? fmtOpt(owner.value) : "—";
  ui.vVersion.textContent = version.ok ? String(version.value) : "—";

  // Full fields
  ui.vL2ChainId.textContent = l2ChainId.ok ? fmtU64(l2ChainId.value) : "—";
  ui.vBatchInbox.textContent = batchInbox.ok ? String(batchInbox.value) : "—";
  ui.vUnsafeSigner.textContent = unsafeSigner.ok ? String(unsafeSigner.value) : "—";
  ui.vBatcherHash.textContent = batcherHash.ok ? fmtBytes32(batcherHash.value) : "—";
  ui.vMinimumGas.textContent = minGas.ok ? fmtU64(minGas.value) : "—";
  ui.vMaximumGas.textContent = maxGas.ok ? fmtU64(maxGas.value) : "—";
  ui.vMinBaseFee.textContent = minBaseFee.ok ? fmtU64(minBaseFee.value) : "—";
  ui.vEip1559Denom.textContent = eipDenom.ok ? fmtU32(eipDenom.value) : "—";
  ui.vEip1559Elast.textContent = eipElast.ok ? fmtU32(eipElast.value) : "—";
  ui.vOpFeeScalar.textContent = opFeeScalar.ok ? fmtU32(opFeeScalar.value) : "—";
  ui.vOpFeeConst.textContent = opFeeConst.ok ? fmtU64(opFeeConst.value) : "—";
  ui.vDaScalar.textContent = daScalar.ok ? fmtU32(daScalar.value) : "—";
  ui.vGuardian.textContent = guardian.ok ? String(guardian.value) : "—";
  ui.vSuperchain.textContent = superchain.ok ? String(superchain.value) : "—";
  ui.vCustomGas.textContent = customGas.ok ? String(customGas.value) : "—";

  ui.vResource.textContent = resource.ok ? safeJson(resource.value) : "—";
  ui.vAddresses.textContent = addresses.ok ? safeJson(addresses.value) : "—";

  setBadge(ui.syncBadge, "ok", "synced (full)");
  ui.btnRefreshLight.disabled = false;
  ui.btnRefreshFull.disabled = false;
  syncInFlight = false;
}

// ------- tx helper -------

let txInFlight = false;

function setTxButtonsDisabled(disabled) {
  ui.btnSetGasLimit.disabled = disabled;
  ui.btnSetEcotone.disabled = disabled;
  ui.btnSetBatcher.disabled = disabled;
  ui.btnSetUnsafe.disabled = disabled;
  ui.btnSetFeature.disabled = disabled;
}

async function sendTx(fnName, args) {
  if (txInFlight) return;
  txInFlight = true;
  setTxButtonsDisabled(true);

  ui.txLog.textContent = "";
  setBadge(ui.txBadge, "info", "submitting");

  try {
    /** @type {import("\-network/connect").TxHandle} */
    const tx =
      args === undefined
        ? await c.write[fnName](undefined, { amount: "0", deposit: "0" })
        : await c.write[fnName](args, { amount: "0", deposit: "0" });

    const unsub = tx.onStatus((u) => {
      if (u.status === "submitted") {
        setBadge(ui.txBadge, "info", "submitted");
        log(`submitted: ${u.hash}`);
      } else if (u.status === "executing") {
        setBadge(ui.txBadge, "warn", "executing");
        log(`executing: ${u.hash}`);
      } else {
        const ok = u.receipt?.ok;
        setBadge(ui.txBadge, ok ? "ok" : "err", u.status);
        log(`${u.status}: ${u.hash}`);
        if (!ok && u.receipt?.error) log(`error: ${u.receipt.error}`);
      }
    });

    const receipt = await tx.wait({ timeoutMs: 90_000 });
    unsub?.();

    if (receipt.ok) {
      log("executed ✅");
      await syncLight();
    } else {
      log("tx failed ❌");
    }
  } catch (e) {
    setBadge(ui.txBadge, "err", "error");
    log(`tx error: ${fmtError(e)}`);
  } finally {
    txInFlight = false;
    setTxButtonsDisabled(false);
  }
}

// ------- events -------

ui.btnRefreshLight.addEventListener("click", async () => {
  await syncLight();
});

ui.btnRefreshFull.addEventListener("click", async () => {
  await syncFull();
});

ui.btnSetGasLimit.addEventListener("click", async () => {
  const raw = ui.inputGasLimit.value.trim();
  if (!raw) return log("enter gas_limit");

  let v;
  try {
    v = BigInt(raw);
  } catch {
    return log("invalid u64");
  }
  if (v < 0n) return log("u64 must be >= 0");
  const U64_MAX = (1n << 64n) - 1n;
  if (v > U64_MAX) return log("value exceeds u64 max");

  await sendTx("set_gas_limit", v);
});

ui.btnSetEcotone.addEventListener("click", async () => {
  const rawA = ui.inputBasefee.value.trim();
  const rawB = ui.inputBlobBasefee.value.trim();
  if (!rawA || !rawB) return log("enter both scalars");

  const a = Number(rawA);
  const b = Number(rawB);
  if (!Number.isInteger(a) || a < 0 || a > 0xffffffff) return log("basefee_scalar must be a u32");
  if (!Number.isInteger(b) || b < 0 || b > 0xffffffff) return log("blobbasefee_scalar must be a u32");

  await sendTx("set_gas_config_ecotone", [a, b]);
});

ui.btnSetBatcher.addEventListener("click", async () => {
  const addr = ui.inputBatcher.value.trim();
  if (!addr) return log("enter batcher address");
  if (!isValidHex20(addr)) return log("invalid EVM address (0x + 40 hex)");
  await sendTx("set_batcher_hash_address", addr);
});

ui.btnSetUnsafe.addEventListener("click", async () => {
  const addr = ui.inputUnsafeSigner.value.trim();
  if (!addr) return log("enter unsafe_block_signer address");
  if (!isValidHex20(addr)) return log("invalid EVM address (0x + 40 hex)");
  await sendTx("set_unsafe_block_signer", addr);
});

ui.btnSetFeature.addEventListener("click", async () => {
  const rawKey = ui.inputFeature.value.trim();
  if (!rawKey) return log("enter a bytes32 key");

  const keyArr = hexToBytes32Array(rawKey);
  if (!keyArr) return log("invalid bytes32 (must be 0x + 64 hex chars)");

  const enabled = ui.selectFeatureEnabled.value === "true";
  await sendTx("set_feature", [keyArr, enabled]);
});

// --------- Boot ---------

(async function boot() {
  ui.configHint.textContent =
    isValidHex32(cfg.contractId) && cfg.contractId !== DEFAULTS.contractId ? `(${cfg.network})` : "(set contractId)";

  setBadge(ui.syncBadge, null, "idle");
  setBadge(ui.txBadge, null, "idle");

  try {
    // Loads the driver WASM (no node calls)
    await dusk.ready();
  } catch (e) {
    log("driver load error: " + fmtError(e));
    setBadge(ui.txBadge, "err", "driver error");
  }
})();
