import { defineDuskConnectButton } from "../../dist/ui.js";
import { asDrc20, createDuskApp, DRC20_METHOD_SIGS, DUSK_CHAIN_PRESETS } from "../../dist/index.js";

defineDuskConnectButton();

const $ = (id) => document.getElementById(id);
const elOut = $("out");

function log(line) {
  if (!elOut) return;
  const prev = elOut.textContent || "";
  elOut.textContent = prev ? prev + "\n" + line : line;
}

function setText(id, text) {
  const el = $(id);
  if (!el) return;
  el.textContent = String(text ?? "");
}

function normalizeContractIdInput(s) {
  const raw = String(s ?? "").trim();
  if (!raw) throw new Error("Missing contractId");
  if (/^0x[0-9a-f]{64}$/i.test(raw)) return raw.toLowerCase();
  if (/^[0-9a-f]{64}$/i.test(raw)) return `0x${raw.toLowerCase()}`;
  throw new Error("Invalid contractId (expected 32-byte hex)");
}

function parseDrcAccount(s) {
  const raw = String(s ?? "").trim();
  if (!raw) throw new Error("Missing account");
  if (/^0x[0-9a-f]{64}$/i.test(raw)) return { Contract: raw.toLowerCase() };
  return { External: raw };
}

function parseU64(s, { name = "value" } = {}) {
  const raw = String(s ?? "").trim();
  if (!raw) throw new Error(`Missing ${name}`);
  let n;
  try {
    n = BigInt(raw);
  } catch {
    throw new Error(`${name} must be a u64 decimal string`);
  }
  if (n < 0n || n > 18446744073709551615n) throw new Error(`${name} out of range for u64`);
  return n.toString();
}

// ----------------------------
// App setup
// ----------------------------

const qs = new URLSearchParams(window.location.search);
const DEFAULT_NODE_URL = String(qs.get("nodeUrl") || "https://testnet.nodes.dusk.network");
const DEFAULT_CHAIN_ID = DUSK_CHAIN_PRESETS.testnet;

// Cache-busting helps during local dev when browsers cache WASM aggressively.
const DRIVER_URL = "./data_driver.wasm?v=" + Date.now();

const dusk = createDuskApp({
  nodeUrl: DEFAULT_NODE_URL,
  chain: { chainId: DEFAULT_CHAIN_ID },
  autoConnect: true,
});

await dusk.ready();

const wallet = dusk.wallet;

const connectBtn = $("connectBtn");
if (connectBtn) connectBtn.wallet = wallet;

// ----------------------------
// Wallet status
// ----------------------------

function renderStatus() {
  const st = wallet.state;
  setText("status", st.installed ? (st.authorized ? "Connected" : "Installed") : "Not installed");
  setText("account", st.selectedAddress || "—");
  setText("chainId", st.chainId || "—");
  setText("nodeUrl", st.node?.nodeUrl || DEFAULT_NODE_URL);
}

wallet.subscribe(() => renderStatus());
renderStatus();

// ----------------------------
// Token helpers
// ----------------------------

let token = null;
let tokenContractId = "";

function requireToken() {
  if (!token || !tokenContractId) throw new Error("Load a contract first");
  return token;
}

async function loadToken() {
  const cid = normalizeContractIdInput($("contractId")?.value);
  tokenContractId = cid;

  const base = dusk.contract({
    contractId: cid,
    driverUrl: DRIVER_URL,
    name: "DRC20",
    methodSigs: DRC20_METHOD_SIGS,
  });

  token = asDrc20(base);
  log(`Loaded contract: ${cid}`);
}

// ----------------------------
// UI actions
// ----------------------------

$("btnLoad")?.addEventListener("click", async () => {
  try {
    await loadToken();
  } catch (e) {
    log(`Error: ${e?.message ?? String(e)}`);
  }
});

$("btnWatch")?.addEventListener("click", async () => {
  try {
    await loadToken();
    const ok = await wallet.watchAsset({
      type: "DRC20",
      options: { contractId: tokenContractId },
    });
    log(`watchAsset: ${String(ok)}`);
  } catch (e) {
    log(`Error: ${e?.message ?? String(e)}`);
  }
});

$("btnMeta")?.addEventListener("click", async () => {
  try {
    await loadToken();
    const t = requireToken();
    const [name, symbol, decimals] = await Promise.all([
      t.read.name(),
      t.read.symbol(),
      t.read.decimals(),
    ]);
    log(`metadata: name=${name} symbol=${symbol} decimals=${decimals}`);
  } catch (e) {
    log(`Error: ${e?.message ?? String(e)}`);
  }
});

$("btnTransfer")?.addEventListener("click", async () => {
  try {
    await loadToken();
    const t = requireToken();
    const to = parseDrcAccount($("to")?.value);
    const value = parseU64($("amount")?.value, { name: "amount" });

    const tx = await t.write.transfer({ to, value });
    log(`transfer submitted: ${tx.hash}`);

    // Best-effort wait helper (doesn't throw on timeout).
    const receipt = await tx.wait({ timeoutMs: 90_000 }).catch(() => null);
    if (receipt) {
      log(`transfer receipt: status=${receipt.status} ok=${receipt.ok}`);
      if (receipt.error) log(`transfer error: ${receipt.error}`);
    }
  } catch (e) {
    log(`Error: ${e?.message ?? String(e)}`);
  }
});

$("btnApprove")?.addEventListener("click", async () => {
  try {
    await loadToken();
    const t = requireToken();
    const spender = parseDrcAccount($("spender")?.value);
    const value = parseU64($("approveAmount")?.value, { name: "allowance" });

    const tx = await t.write.approve({ spender, value });
    log(`approve submitted: ${tx.hash}`);
  } catch (e) {
    log(`Error: ${e?.message ?? String(e)}`);
  }
});

$("btnApproveMax")?.addEventListener("click", async () => {
  try {
    await loadToken();
    const t = requireToken();
    const spender = parseDrcAccount($("spender")?.value);
    const value = "18446744073709551615";

    const tx = await t.write.approve({ spender, value });
    log(`approve MAX submitted: ${tx.hash}`);
  } catch (e) {
    log(`Error: ${e?.message ?? String(e)}`);
  }
});

