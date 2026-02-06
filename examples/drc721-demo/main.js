import { defineDuskConnectButton } from "../../dist/ui.js";
import { asDrc721, createDuskApp, DRC721_METHOD_SIGS, DUSK_CHAIN_PRESETS } from "../../dist/index.js";

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

function accountEnumToString(a) {
  if (!a) return "";
  if (typeof a === "string") return a;
  if (typeof a === "object") {
    if (typeof a.External === "string") return a.External;
    if (typeof a.Contract === "string") return a.Contract;
  }
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
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
// NFT helpers
// ----------------------------

let nft = null;
let nftContractId = "";

function requireNft() {
  if (!nft || !nftContractId) throw new Error("Load a contract first");
  return nft;
}

async function loadNft() {
  const cid = normalizeContractIdInput($("contractId")?.value);
  nftContractId = cid;

  const base = dusk.contract({
    contractId: cid,
    driverUrl: DRIVER_URL,
    name: "DRC721",
    methodSigs: DRC721_METHOD_SIGS,
  });

  nft = asDrc721(base);
  log(`Loaded contract: ${cid}`);
}

function getTokenId() {
  return parseU64($("tokenId")?.value, { name: "tokenId" });
}

// ----------------------------
// UI actions
// ----------------------------

$("btnLoad")?.addEventListener("click", async () => {
  try {
    await loadNft();
  } catch (e) {
    log(`Error: ${e?.message ?? String(e)}`);
  }
});

$("btnMeta")?.addEventListener("click", async () => {
  try {
    await loadNft();
    const n = requireNft();
    const [name, symbol, baseUri] = await Promise.all([
      n.read.name(),
      n.read.symbol(),
      n.read.baseUri(),
    ]);
    log(`metadata: name=${name} symbol=${symbol} base_uri=${baseUri}`);
  } catch (e) {
    log(`Error: ${e?.message ?? String(e)}`);
  }
});

$("btnOwner")?.addEventListener("click", async () => {
  try {
    await loadNft();
    const n = requireNft();
    const token_id = getTokenId();
    const owner = await n.read.ownerOf({ token_id });
    log(`owner_of(${token_id}) = ${accountEnumToString(owner)}`);
  } catch (e) {
    log(`Error: ${e?.message ?? String(e)}`);
  }
});

$("btnTokenUri")?.addEventListener("click", async () => {
  try {
    await loadNft();
    const n = requireNft();
    const token_id = getTokenId();
    const uri = await n.read.tokenUri({ token_id });
    log(`token_uri(${token_id}) = ${uri}`);
  } catch (e) {
    log(`Error: ${e?.message ?? String(e)}`);
  }
});

$("btnWatch")?.addEventListener("click", async () => {
  try {
    await loadNft();
    const tokenId = getTokenId();
    const ok = await wallet.watchAsset({
      type: "DRC721",
      options: { contractId: nftContractId, tokenId },
    });
    log(`watchAsset: ${String(ok)}`);
  } catch (e) {
    log(`Error: ${e?.message ?? String(e)}`);
  }
});

$("btnApprove")?.addEventListener("click", async () => {
  try {
    await loadNft();
    const n = requireNft();
    const token_id = getTokenId();
    const approved = parseDrcAccount($("approved")?.value);
    const tx = await n.write.approve({ approved, token_id });
    log(`approve submitted: ${tx.hash}`);
  } catch (e) {
    log(`Error: ${e?.message ?? String(e)}`);
  }
});

$("btnSetApprovalForAll")?.addEventListener("click", async () => {
  try {
    await loadNft();
    const n = requireNft();
    const operator = parseDrcAccount($("operator")?.value);
    const approved = String($("operatorApproved")?.value ?? "true") === "true";
    const tx = await n.write.setApprovalForAll({ operator, approved });
    log(`set_approval_for_all submitted: ${tx.hash}`);
  } catch (e) {
    log(`Error: ${e?.message ?? String(e)}`);
  }
});

$("btnTransferFrom")?.addEventListener("click", async () => {
  try {
    await loadNft();
    const n = requireNft();
    const token_id = getTokenId();
    const from = parseDrcAccount($("from")?.value);
    const to = parseDrcAccount($("to")?.value);
    const tx = await n.write.transferFrom({ from, to, token_id });
    log(`transfer_from submitted: ${tx.hash}`);
  } catch (e) {
    log(`Error: ${e?.message ?? String(e)}`);
  }
});

