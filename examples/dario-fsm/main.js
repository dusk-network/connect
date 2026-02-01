import { defineMochaviConnectButton } from "../../dist/ui.js";
import { createDuskApp, DUSK_CHAIN_PRESETS } from "../../dist/index.js";

defineMochaviConnectButton();

// -------------------------------------------
// Config
// -------------------------------------------

const CONTRACT_ID =
  "0x4084feea63382d816a7faace85c2c24abd84ea04bff95bfdbd357450640e0c60";
const DEFAULT_TESTNET_NODE = "https://devnet.nodes.dusk.network";

// Cache-busting helps during local dev when browsers cache WASM aggressively.
const DRIVER_URL = "./data_driver.wasm?v=" + Date.now();

const STATE_META = [
  { name: "Regular", sprite: "./assets/dario-regular.svg" },
  { name: "Super", sprite: "./assets/dario-super.svg" },
  { name: "Fire", sprite: "./assets/dario-fire.svg" },
  { name: "Cape", sprite: "./assets/dario-cape.svg" },
  { name: "Game Over", sprite: "./assets/dario-gameover.svg" },
];

const ACTION_META = {
  0: { label: "Espresso", emoji: "☕" },
  1: { label: "Chili", emoji: "🌶️" },
  2: { label: "Cape", emoji: "🧣" },
  3: { label: "Damage", emoji: "💥" },
  4: { label: "Revive", emoji: "💙" },
};

// -------------------------------------------
// App setup
// -------------------------------------------

const dusk = createDuskApp({
  nodeUrl: DEFAULT_TESTNET_NODE,
  chain: { chainId: DUSK_CHAIN_PRESETS.devnet },
  autoConnect: true,
  contracts: {
    dario: {
      contractId: CONTRACT_ID,
      driverUrl: DRIVER_URL,
      name: "Dario FSM",
      methodSigs: {
        current_state: "current_state()",
        revive_count: "revive_count()",
        handle_event: "handle_event(u32)",
      },
    },
  },
});

const wallet = dusk.wallet;
const dario = dusk.contract("dario");

// Connect button (web component)
const connectBtn = document.getElementById("connectBtn");
if (connectBtn) connectBtn.wallet = wallet;

// -------------------------------------------
// DOM
// -------------------------------------------

const $ = (id) => document.getElementById(id);

const elSprite = $("darioSprite");
const elStage = document.querySelector(".stage");
const elHudState = $("hudState");
const elHudRevives = $("hudRevives");
const elHint = $("hint");
const elDeadOverlay = $("deadOverlay");
const elStartOverlay = $("startOverlay");
const elStartBtn = $("startBtn");
const elPendingOverlay = $("pendingOverlay");
const elPendingText = $("pendingText");
const elActions = $("actions");
const elReviveBig = $("reviveBig");

// -------------------------------------------
// Model
// -------------------------------------------

const model = {
  state: null, // number | null
  revives: null, // number | null
  pending: false,
  pendingPhase: "", // "" | "sign" | "finalize"
  lastAction: null, // number | null
  error: null, // string | null
};

function isDead(state) {
  return Number(state) === 4;
}

function metaForState(state) {
  const i = Number(state);
  return Number.isFinite(i) && STATE_META[i] ? STATE_META[i] : STATE_META[0];
}

function setText(node, text) {
  if (!node) return;
  node.textContent = text;
}

function render() {
  const dead = isDead(model.state);
  const authorized = wallet.state.authorized;

  // Stage state for CSS ambience.
  if (elStage) elStage.dataset.state = String(model.state ?? 0);

  // Sprite
  const meta = metaForState(model.state);
  if (elSprite && elSprite.getAttribute("src") !== meta.sprite) {
    // Small cross-fade between sprites.
    elSprite.style.opacity = "0";
    window.setTimeout(() => {
      elSprite.setAttribute("src", meta.sprite);
      elSprite.style.opacity = "1";
    }, 120);
  }

  // HUD
  setText(elHudState, model.state == null ? "—" : meta.name);
  setText(elHudRevives, model.revives == null ? "💙 —" : `💙 ${model.revives}`);

  // Overlays (priority: pending > start > dead)
  if (elPendingOverlay) elPendingOverlay.hidden = !model.pending;
  if (elStartOverlay) elStartOverlay.hidden = authorized || model.pending;
  if (elDeadOverlay) elDeadOverlay.hidden = !authorized || model.pending || !dead;

  // Pending copy + progress
  if (elPendingText) {
    if (!model.pending) {
      elPendingText.textContent = "Waiting for finalization…";
    } else {
      const a = ACTION_META[model.lastAction] || { label: "Move", emoji: "" };
      if (model.pendingPhase === "sign") {
        elPendingText.textContent = `Confirm ${a.emoji} ${a.label} in your wallet…`;
      } else if (model.pendingPhase === "submitted") {
        elPendingText.textContent = `Submitted ${a.emoji} ${a.label}. Waiting for execution…`;
      } else {
        // executing (or unknown)
        elPendingText.textContent = `Finalizing ${a.emoji} ${a.label} on-chain…`;
      }
    }
  }
  // The progress bar is an indeterminate CSS animation.

  // Actions: only show Revive when dead, otherwise show the 4 actions.
  const buttons = elActions ? elActions.querySelectorAll("[data-event]") : [];
  for (const btn of buttons) {
    const ev = Number(btn.getAttribute("data-event"));
    const show = dead ? ev === 4 : ev !== 4;
    btn.hidden = !show;
    btn.disabled = !authorized || model.pending;
  }

  // Big revive button in overlay.
  if (elReviveBig) {
    elReviveBig.disabled = !authorized || model.pending;
  }

  // Hint line
  if (elHint) {
    if (model.error) {
      elHint.textContent = model.error;
    } else if (!authorized) {
      elHint.textContent = "Connect your wallet to play.";
    } else if (model.pending) {
      elHint.textContent =
        model.pendingPhase === "sign"
          ? "Confirm the transaction in your wallet…"
          : "Waiting for on-chain execution…";
    } else if (dead) {
      elHint.textContent = "Revive Dario to continue.";
    } else {
      elHint.textContent = "Choose an action.";
    }
  }
}

// -------------------------------------------
// Chain I/O
// -------------------------------------------

let syncPromise = null;
let syncFailStreak = 0;

async function sync() {
  if (syncPromise) return syncPromise;

  syncPromise = (async () => {
    try {
      const before = model.state;
      const [st, rv] = await Promise.all([
        dario.call.current_state(),
        dario.call.revive_count(),
      ]);

      model.state = Number(st);
      model.revives = Number(rv);
      syncFailStreak = 0;
      model.error = null;

      // One-shot FX only when the on-chain state actually changed.
      if (before != null && model.state !== before) {
        pulseFx(before, model.state);
      }
    } catch {
      // Testnet nodes can occasionally return transient 502/503 errors.
      // Don't spam the player: only show a hint after repeated failures.
      syncFailStreak++;
      if (model.state == null || syncFailStreak >= 3) {
        model.error = "Unable to sync on-chain state.";
      } else if (syncFailStreak >= 2) {
        model.error = "Network hiccup… retrying.";
      } else {
        model.error = null;
      }
    } finally {
      render();
    }
  })();

  try {
    await syncPromise;
  } finally {
    syncPromise = null;
  }
}

function pulseFx(prev, next) {
  if (!elStage) return;
  let kind = "";

  if (Number(next) === 4) kind = "hit";
  else if (Number(prev) === 4 && Number(next) === 0) kind = "revive";
  else if (Number(next) === 1) kind = "spark";
  else if (Number(next) === 2) kind = "ember";
  else if (Number(next) === 3) kind = "wind";

  if (!kind) return;

  elStage.dataset.fx = kind;
  window.setTimeout(() => {
    if (elStage.dataset.fx === kind) delete elStage.dataset.fx;
  }, 750);
}

async function sendEvent(ev) {
  if (model.pending) return;

  model.lastAction = ev;

  // If user isn't connected yet, prompt.
  if (!wallet.state.authorized) {
    try {
      await wallet.connect();
    } catch {
      // user rejected
      return;
    }
  }

  model.pending = true;
  model.pendingPhase = "sign";
  model.error = null;
  render();

  try {
    // The wallet resolves once the tx is **submitted** to the node.
    // For a game-y UX we want to keep the loading overlay until the
    // transaction is actually **executed** in an accepted block.
    const tx = await dario.write.handle_event(ev, { amount: "0", deposit: "0" });

    // Track tx lifecycle via the SDK (submitted -> executing -> executed/failed/timeout)
    const unsubscribe = tx.onStatus((u) => {
      if (u.status === "submitted") model.pendingPhase = "submitted";
      if (u.status === "executing") model.pendingPhase = "executing";
      if ((u.status === "failed" || u.status === "timeout") && u.receipt?.error) {
        model.error = u.receipt.error;
      }
      render();
    });

    // Wait until the tx is executed (best-effort) then sync.
    let receipt;
    try {
      receipt = await tx.wait({ timeoutMs: 60_000 });
    } finally {
      unsubscribe();
    }

    if (!receipt.ok && receipt.error) model.error = receipt.error;

    // One final sync to refresh state/revive_count from chain.
    await sync();

    // If we timed out waiting for execution, don't block the game;
    // the passive sync loop will eventually catch up.
    if (receipt.status === "timeout") {
      model.error = "Still processing… it may take a bit longer.";
      render();
    }
  } catch {
    model.error = "Transaction rejected or failed.";
    model.pending = false;
    model.pendingPhase = "";
    render();
    return;
  }

  model.pending = false;
  model.pendingPhase = "";
  render();
}

// -------------------------------------------
// Wire up UI
// -------------------------------------------

elActions?.addEventListener("click", (e) => {
  const btn = e.target?.closest?.("[data-event]");
  if (!btn) return;
  const ev = Number(btn.getAttribute("data-event"));
  if (!Number.isFinite(ev)) return;
  sendEvent(ev);
});

elReviveBig?.addEventListener("click", () => sendEvent(4));

elStartBtn?.addEventListener("click", async () => {
  try {
    // Prefer the SDK UI (modal) when present.
    // NOTE: calling `connectBtn.click()` does *not* trigger the internal shadow button
    // click handler of the web-component. Use the explicit `open()` API when available.
    if (typeof connectBtn?.open === "function") {
      connectBtn.open();
    } else if (connectBtn?.shadowRoot?.querySelector) {
      // Best-effort fallback for older builds.
      const inner = connectBtn.shadowRoot.querySelector("button");
      if (inner?.click) inner.click();
      else await wallet.connect();
    } else {
      await wallet.connect();
    }
  } catch {
    // user rejected
  }
});

wallet.subscribe(() => render());

// -------------------------------------------
// Init
// -------------------------------------------

async function init() {
  render();

  await wallet.ready();

  // Warm the data-driver (ensures the first click is snappy).
  try {
    await dusk.driver(DRIVER_URL);
  } catch {
    model.error = "Missing or incompatible data_driver.wasm.";
    render();
  }

  // First sync (reads do not require wallet connection)
  await sync();

  // Passive sync so you can see other players' actions.
  setInterval(() => {
    if (!model.pending) sync();
  }, 8000);
}

init();
