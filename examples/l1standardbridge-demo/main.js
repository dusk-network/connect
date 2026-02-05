/**
 * L1StandardBridge demo (browser dApp)
 * ------------------------------------------------------------
 * - Uses Dusk Wallet extension (window.dusk)
 * - Uses createDuskApp() + a local WASM data-driver for encode/decode
 * - Reads via contract.call.*
 * - Writes via contract.write.* with tx.onStatus + tx.wait
 *
 * IMPORTANT: reads are NOT polled. Click Refresh to query the node.
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
  contractId: "0x" + "68dc20de32bd15f9374c790e761806925fc283e561d4fea25e1603d727abba6d",
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
  // drivers often serialize u64 as JSON strings to avoid JS float issues.
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "bigint") return v.toString();
  return String(v);
}

function fmtOpt(v) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  // Option<Address> sometimes comes as null or a nested structure.
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
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
    bridge: {
      name: "L1StandardBridge",
      contractId: cfg.contractId,
      driverUrl: cfg.driverUrl,
      methodSigs: {
        is_paused: "is_paused()",
        pause: "pause()",
        unpause: "unpause()",
        owner: "owner()",
        version: "version()",
        deposit_fee: "deposit_fee()",
        deposit_gas_limit: "deposit_gas_limit()",
        set_u64: "set_u64(SetU64)",
        set_evm_address_or_offset: "set_evm_address_or_offset(SetEVMAddressOrOffset)",
      },
    },
  },
});

const wallet = dusk.wallet;
const c = dusk.contract("bridge");

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
  vDepositFee: $("v-deposit-fee"),
  vDepositGas: $("v-deposit-gas"),
  vOwner: $("v-owner"),
  vVersion: $("v-version"),

  fullFieldsWrap: $("full-fields"),
  vFinalization: $("v-finalization"),
  vMinGas: $("v-min-gas"),
  vMaxData: $("v-max-data"),
  vCollected: $("v-collected"),
  vNonce: $("v-nonce"),
  vNextBridge: $("v-next-bridge"),
  vThisBridgeMapped: $("v-this-bridge-mapped"),
  vThisMessengerMapped: $("v-this-messenger-mapped"),

  btnRefreshLight: /** @type {HTMLButtonElement} */ ($("btn-refresh-light")),
  btnRefreshFull: /** @type {HTMLButtonElement} */ ($("btn-refresh-full")),

  txBadge: $("tx-status"),
  txLog: /** @type {HTMLElement} */ ($("tx-log")),

  btnPause: /** @type {HTMLButtonElement} */ ($("btn-pause")),
  btnUnpause: /** @type {HTMLButtonElement} */ ($("btn-unpause")),

  selectU64: /** @type {HTMLSelectElement} */ ($("select-u64")),
  inputU64: /** @type {HTMLInputElement} */ ($("input-u64")),
  btnSetU64: /** @type {HTMLButtonElement} */ ($("btn-set-u64")),

  selectEvm: /** @type {HTMLSelectElement} */ ($("select-evm")),
  inputEvm: /** @type {HTMLInputElement} */ ($("input-evm")),
  btnSetEvm: /** @type {HTMLButtonElement} */ ($("btn-set-evm")),
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
    // cancel previous, then proceed
    try {
      syncAbort?.abort();
    } catch {}
  }
  syncInFlight = true;

  // abort any in-flight reads
  syncAbort = new AbortController();
  const signal = syncAbort.signal;

  ui.btnRefreshLight.disabled = true;
  ui.btnRefreshFull.disabled = true;
  setBadge(ui.syncBadge, "info", "loading");

  // NOTE: keep this list small to avoid triggering nodes with many queries.
  const paused = await readOne("is_paused", () => c.call.is_paused(undefined, { signal }));
  await sleep(60);
  const depositFee = await readOne("deposit_fee", () => c.call.deposit_fee(undefined, { signal }));
  await sleep(60);
  const depositGas = await readOne("deposit_gas_limit", () =>
    c.call.deposit_gas_limit(undefined, { signal })
  );
  await sleep(60);
  const owner = await readOne("owner", () => c.call.owner(undefined, { signal }));
  await sleep(60);
  const version = await readOne("version", () => c.call.version(undefined, { signal }));

  ui.vPaused.textContent = paused.ok ? String(paused.value) : "—";
  ui.vDepositFee.textContent = depositFee.ok ? fmtU64(depositFee.value) : "—";
  ui.vDepositGas.textContent = depositGas.ok ? fmtU64(depositGas.value) : "—";
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
  const paused = await readOne("is_paused", () => c.call.is_paused(undefined, { signal }));
  await sleep(60);
  const depositFee = await readOne("deposit_fee", () => c.call.deposit_fee(undefined, { signal }));
  await sleep(60);
  const depositGas = await readOne("deposit_gas_limit", () =>
    c.call.deposit_gas_limit(undefined, { signal })
  );
  await sleep(60);
  const owner = await readOne("owner", () => c.call.owner(undefined, { signal }));
  await sleep(60);
  const version = await readOne("version", () => c.call.version(undefined, { signal }));
  await sleep(60);

  const finalization = await readOne("finalization_period", () =>
    c.call.finalization_period(undefined, { signal })
  );
  await sleep(60);
  const minGas = await readOne("min_gas_limit", () => c.call.min_gas_limit(undefined, { signal }));
  await sleep(60);
  const maxData = await readOne("max_data_length", () => c.call.max_data_length(undefined, { signal }));
  await sleep(60);
  const collected = await readOne("collected_deposit_fees", () =>
    c.call.collected_deposit_fees(undefined, { signal })
  );
  await sleep(60);
  const nonce = await readOne("nonce", () => c.call.nonce(undefined, { signal }));
  await sleep(60);
  const nextBridge = await readOne("next_bridge", () => c.call.next_bridge(undefined, { signal }));
  await sleep(60);
  const thisBridgeMapped = await readOne("this_bridge_mapped", () => c.call.this_bridge_mapped(undefined, { signal }));
  await sleep(60);
  const thisMessengerMapped = await readOne("this_messenger_mapped", () => c.call.this_messenger_mapped(undefined, { signal }));

  // Top panel
  ui.vPaused.textContent = paused.ok ? String(paused.value) : "—";
  ui.vDepositFee.textContent = depositFee.ok ? fmtU64(depositFee.value) : "—";
  ui.vDepositGas.textContent = depositGas.ok ? fmtU64(depositGas.value) : "—";
  ui.vOwner.textContent = owner.ok ? fmtOpt(owner.value) : "—";
  ui.vVersion.textContent = version.ok ? String(version.value) : "—";

  // Extra fields
  ui.vFinalization.textContent = finalization.ok ? fmtU64(finalization.value) : "—";
  ui.vMinGas.textContent = minGas.ok ? fmtU64(minGas.value) : "—";
  ui.vMaxData.textContent = maxData.ok ? fmtU64(maxData.value) : "—";
  ui.vCollected.textContent = collected.ok ? fmtU64(collected.value) : "—";
  ui.vNonce.textContent = nonce.ok ? fmtOpt(nonce.value) : "—";
  ui.vNextBridge.textContent = nextBridge.ok ? fmtOpt(nextBridge.value) : "—";
  ui.vThisBridgeMapped.textContent = thisBridgeMapped.ok ? fmtOpt(thisBridgeMapped.value) : "—";
  ui.vThisMessengerMapped.textContent = thisMessengerMapped.ok ? fmtOpt(thisMessengerMapped.value) : "—";

  setBadge(ui.syncBadge, "ok", "synced (full)");
  ui.btnRefreshLight.disabled = false;
  ui.btnRefreshFull.disabled = false;
  syncInFlight = false;
}

// ------- tx helper -------

let txInFlight = false;

function setTxButtonsDisabled(disabled) {
  ui.btnPause.disabled = disabled;
  ui.btnUnpause.disabled = disabled;
  ui.btnSetU64.disabled = disabled;
  ui.btnSetEvm.disabled = disabled;
}

async function sendTx(fnName, args) {
  if (txInFlight) return;
  txInFlight = true;
  setTxButtonsDisabled(true);

  ui.txLog.textContent = "";
  setBadge(ui.txBadge, "info", "submitting");

  try {
    /** @type {import("@dusk-network/dusk-wallet-sdk").TxHandle} */
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
      // refresh after successful tx (light)
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

ui.btnPause.addEventListener("click", async () => {
  await sendTx("pause");
});

ui.btnUnpause.addEventListener("click", async () => {
  await sendTx("unpause");
});

ui.btnSetU64.addEventListener("click", async () => {
  const variant = ui.selectU64.value;
  const raw = ui.inputU64.value.trim();
  if (!raw) {
    log("enter a u64 value");
    return;
  }

  let v;
  try {
    v = BigInt(raw);
  } catch {
    log("invalid u64");
    return;
  }
  if (v < 0n) {
    log("u64 must be >= 0");
    return;
  }
  const U64_MAX = (1n << 64n) - 1n;
  if (v > U64_MAX) {
    log("value exceeds u64 max");
    return;
  }

  // Enum JSON shape: { VariantName: value }
  const payload = { [variant]: v };
  await sendTx("set_u64", payload);
});

ui.btnSetEvm.addEventListener("click", async () => {
  const variant = ui.selectEvm.value;
  const raw = ui.inputEvm.value.trim();
  if (!raw) {
    log("enter an EVM address (0x...)");
    return;
  }
  if (!isValidHex20(raw)) {
    log("invalid EVM address (must be 20 bytes: 0x + 40 hex)");
    return;
  }

  const payload = { [variant]: raw };
  await sendTx("set_evm_address_or_offset", payload);
});

// --------- Boot ---------

(async function boot() {
  ui.configHint.textContent = isValidHex32(cfg.contractId) ? `(${cfg.network})` : "(set contractId)";

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