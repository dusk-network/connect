/**
 * Counter Contract demo (browser dApp)
 * ------------------------------------------------------------
 * - Uses Dusk Wallet extension (window.dusk)
 * - Uses createDuskApp() + auto-generated WASM data-driver
 * - Reads via contract.call.*
 * - Writes via contract.write.* with tx.onStatus + tx.wait
 *
 * This demo tests the #[contract] macro from dusk-wasm.
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
  // placeholder - replace with actual deployed contract ID
  contractId: "0x" + "3e8ae39293bcf291c59e4b506279f24ad18816dab62accf64f1449e4563f9dae",
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
    counter: {
      name: "Counter",
      contractId: cfg.contractId,
      driverUrl: cfg.driverUrl,
      methodSigs: {
        read_value: "read_value()",
        increment: "increment()",
        init: "init(u32)",
      },
    },
  },
});

const wallet = dusk.wallet;
const c = dusk.contract("counter");

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
  vCounter: $("v-counter"),
  btnRefresh: /** @type {HTMLButtonElement} */ ($("btn-refresh")),

  txBadge: $("tx-status"),
  txLog: /** @type {HTMLElement} */ ($("tx-log")),

  btnIncrement: /** @type {HTMLButtonElement} */ ($("btn-increment")),
  inputInit: /** @type {HTMLInputElement} */ ($("input-init")),
  btnInit: /** @type {HTMLButtonElement} */ ($("btn-init")),
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

// ------- reads -------

let syncInFlight = false;

async function syncCounter() {
  if (syncInFlight) return;
  syncInFlight = true;

  ui.btnRefresh.disabled = true;
  setBadge(ui.syncBadge, "info", "loading");

  try {
    const value = await c.call.read_value();
    ui.vCounter.textContent = String(value);
    setBadge(ui.syncBadge, "ok", "synced");
    log(`read_value() = ${value}`);
  } catch (e) {
    ui.vCounter.textContent = "—";
    setBadge(ui.syncBadge, "err", "error");
    log(`read_value failed: ${fmtError(e)}`);
  } finally {
    ui.btnRefresh.disabled = false;
    syncInFlight = false;
  }
}

// ------- tx helper -------

let txInFlight = false;

function setTxButtonsDisabled(disabled) {
  ui.btnIncrement.disabled = disabled;
  ui.btnInit.disabled = disabled;
}

async function sendTx(fnName, args) {
  if (txInFlight) return;
  txInFlight = true;
  setTxButtonsDisabled(true);

  setBadge(ui.txBadge, "info", "submitting");

  try {
    /** @type {import("@dusk-network/connect").TxHandle} */
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
      log(`${fnName}() executed ✅`);
      // refresh after successful tx
      await syncCounter();
    } else {
      log(`${fnName}() failed ❌`);
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

ui.btnRefresh.addEventListener("click", async () => {
  await syncCounter();
});

ui.btnIncrement.addEventListener("click", async () => {
  log("calling increment()...");
  await sendTx("increment");
});

ui.btnInit.addEventListener("click", async () => {
  const raw = ui.inputInit.value.trim();
  if (!raw) {
    log("enter an initial value");
    return;
  }

  let v;
  try {
    v = parseInt(raw, 10);
  } catch {
    log("invalid number");
    return;
  }
  if (v < 0 || v > 0xffffffff) {
    log("value must be a valid u32 (0 to 4294967295)");
    return;
  }

  log(`calling init(${v})...`);
  await sendTx("init", v);
});

// --------- Boot ---------

(async function boot() {
  ui.configHint.textContent = isValidHex32(cfg.contractId)
    ? `(${cfg.network})`
    : "(set contractId)";

  setBadge(ui.syncBadge, null, "idle");
  setBadge(ui.txBadge, null, "idle");

  try {
    // Loads the driver WASM (no node calls)
    await dusk.ready();
    log("data-driver loaded ✅");
  } catch (e) {
    log("driver load error: " + fmtError(e));
    setBadge(ui.txBadge, "err", "driver error");
  }
})();
