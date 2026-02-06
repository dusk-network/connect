# Dusk Connect (dApp integration)

A tiny, framework-agnostic SDK for the **Dusk Wallet injected provider** (`window.dusk`).

- **Lightweight** (no runtime deps)
- **Typed** (TypeScript types for the provider + RPC methods)
- Includes an **optional connect modal** (conceptually similar to a very small Reown/AppKit)
- Includes an optional **WalletConnect-style connect button** (`<dusk-connect-button />`) for drop-in UI

This SDK targets the wallet provider described in the Dusk Wallet repo:
`docs/provider-api.md`.

- `dusk_getCapabilities`
- `dusk_requestAccounts`
- `dusk_accounts`
- `dusk_chainId`
- `dusk_switchNetwork`
- `dusk_getPublicBalance`
- `dusk_estimateGas`
- `dusk_sendTransaction`
- `dusk_watchAsset`
- `dusk_signMessage`
- `dusk_signAuth`
- `dusk_disconnect`

## Vanilla demo

A no-bundler demo lives at `examples/vanilla/` and imports the SDK directly from `dist/`.

Run a static server from the SDK root:

```bash
python3 -m http.server 5173
```

Then open `http://localhost:5173/examples/vanilla/`.

## Dario FSM demo

A small **on-chain game UI** for the `dario_fsm_contract` lives at `examples/dario-fsm/`.

Open it via:

- `http://localhost:5173/examples/dario-fsm/`

This demo shows:

- how to use a compiled **data-driver** (`data_driver.wasm`) to encode/decode contract calls (locally)
- how to read contract state using **read-only calls**:
  - `current_state() -> u32`
  - `revive_count() -> u32`
- how to submit a `contract_call` transaction:
  - `handle_event(u32)` (Espresso / Chili / Cape / Damage / Revive)

The UI is intentionally minimal: a stage, a HUD (state + revives), and context-aware actions.

## Schema explorer demo

An isolated **contract schema explorer** lives at `examples/schema-explorer/`.

Open it via:

- `http://localhost:5173/examples/schema-explorer/`

This demo focuses on inspecting a data-driver schema and invoking methods based on the schema metadata.

## Install

```bash
npm i @dusk-network/connect
```

## Which entrypoint should I use?

### `createDuskWallet()` / `DuskWallet`

Use this when you only need to interact with the **injected wallet provider** (`window.dusk`):

- connect / disconnect
- read accounts + chain
- get balances
- send transactions

It’s the smallest surface area and has no opinion about contracts, nodes, or data-drivers.

```ts
import { createDuskWallet } from "@dusk-network/connect";

const wallet = createDuskWallet();
await wallet.ready();

await wallet.connect();
console.log(wallet.state.accounts);
```

### `createDuskApp()`

Use this when you’re building a **smart contract dApp** and you want one object that wires together:

- a `DuskWallet` instance (`dusk.wallet`)
- a node client for **read-only contract calls**
- a WASM **data-driver** loader/cache
- ergonomic helpers inspired by Viem/Wagmi:
  - `readContract()`
  - `prepareContractCall()`
  - `writeContract()`

```ts
import { createDuskApp, DUSK_CHAIN_PRESETS } from "@dusk-network/connect";

const dusk = createDuskApp({
  nodeUrl: "https://testnet.nodes.dusk.network",
  chain: { chainId: DUSK_CHAIN_PRESETS.testnet },
});

await dusk.ready();

// dApps/UI components still use the same wallet instance
await dusk.wallet.connect();
```

Tip: you can share a wallet instance between both APIs:

```ts
const wallet = createDuskWallet();
const dusk = createDuskApp({ wallet, nodeUrl: "https://testnet.nodes.dusk.network" });
```

## Quick start (core)

```ts
import {
  createDuskWallet,
  parseDuskToLux,
  formatLuxShort,
  ERROR_CODES,
} from "@dusk-network/connect";

const wallet = createDuskWallet();
await wallet.ready();

// Optional: reactively track wallet state
wallet.subscribe((state) => {
  console.log("wallet state", state);
});

if (!wallet.state.installed) {
  // show "Install Dusk Wallet" UI
}

// Prompt connection (opens wallet approval)
try {
  const accounts = await wallet.connect();
  console.log("Connected account", accounts[0]);
} catch (err: any) {
  if (err?.code === ERROR_CODES.USER_REJECTED) {
    console.log("user rejected");
  }
}

// Read balance
const bal = await wallet.getPublicBalance();
console.log("Balance", formatLuxShort(bal.value), "DUSK");

// Send a transfer
await wallet.sendTransfer({
  to: "<base58-account-id>",
  amount: parseDuskToLux("1.5"), // 1.5 DUSK -> Lux string
  memo: "hello",
});
```

## Contract call

```ts
import { createDuskWallet } from "@dusk-network/connect";

const wallet = createDuskWallet();
await wallet.connect();

const tx = await wallet.sendContractCall({
  contractId: "0x" + "02".padEnd(64, "0"), // 32 bytes
  fnName: "get_version",
  fnArgs: "0x", // opaque bytes (hex/base64/number[]/Uint8Array supported)
  display: { contractName: "Example", methodSig: "get_version()" },
});

console.log("tx", tx.hash);
```

## Quick start (dApp app + contracts)

If you want a **single entrypoint** for contract developers:

- wallet state + connect/disconnect
- node contract calls (read-only)
- data-driver loading (WASM)
- simple helpers inspired by **Viem/Wagmi** (`readContract / prepareContractCall / writeContract`)
- an optional proxy facade (`dusk.contract("...")`)

use `createDuskApp()`.

```ts
import { createDuskApp, DUSK_CHAIN_PRESETS, parseDuskToLux } from "@dusk-network/connect";
import { defineDuskConnectButton } from "@dusk-network/connect/ui";

defineDuskConnectButton();

const dusk = createDuskApp({
  // for read calls (fallback when wallet hasn't provided a node yet)
  nodeUrl: "https://testnet.nodes.dusk.network",

  // enforced before contract writes
  chain: { chainId: DUSK_CHAIN_PRESETS.testnet },

  autoConnect: true,

  // Optional presets so you can do dusk.contract("dario")
  contracts: {
    dario: {
      contractId: "0x<YOUR_CONTRACT_ID>",
      driverUrl: "/data_driver.wasm",
      name: "Dario FSM",
      methodSigs: {
        current_state: "current_state()",
        revive_count: "revive_count()",
        handle_event: "handle_event(u32)",
      },
    },
  },
});

await dusk.ready();

// Wire the connect button to the same wallet instance
document.querySelector("dusk-connect-button")!.wallet = dusk.wallet;

// Read-only calls (node executes, driver decodes locally)
const state = await dusk.readContract({ contract: "dario", functionName: "current_state" });
const revives = await dusk.readContract({ contract: "dario", functionName: "revive_count" });

// Build tx params (for previews / custom flows)
const params = await dusk.prepareContractCall({
  contract: "dario",
  functionName: "handle_event",
  args: 0,
  amount: parseDuskToLux("0"),
  deposit: parseDuskToLux("0"),
});
console.log("contract_call params", params);

// Send (auto-connects + ensures chain)
const tx = await dusk.writeContract({
  contract: "dario",
  functionName: "handle_event",
  args: 0,
  amount: parseDuskToLux("0"),
  deposit: parseDuskToLux("0"),
});
console.log("tx hash", tx.hash);

// Optional: subscribe to status updates (submitted -> executed/failed/timeout)
const unsubscribe = tx.onStatus((u) => {
  console.log("tx status", u.status);
  if (u.status === "failed" || u.status === "timeout") {
    console.warn("tx error", u.receipt?.error);
  }
});

// Optional: wait for execution (RUES event stream)
const receipt = await tx.wait({ timeoutMs: 60_000 });
console.log("executed?", receipt.ok, receipt.status, receipt.error);

unsubscribe();

// Optional: proxy facade (w3sper-ish)
// const dario = dusk.contract("dario");
// const st = await dario.call.current_state();
```

## Switch network / chain

The wallet will show a user approval prompt.
Chain IDs use CAIP-2 format (`dusk:<id>`).

```ts
import { createDuskWallet, DUSK_CHAIN_PRESETS } from "@dusk-network/connect";

const wallet = createDuskWallet();
await wallet.connect();

// Prefer preset chain ids (mainnet/testnet/devnet/local)
await wallet.switchChain({ chainId: DUSK_CHAIN_PRESETS.testnet });

// ...or switch to a custom node
await wallet.switchChain({ nodeUrl: "https://my.custom.node:9000" });
```

## Ensure chain (optional helper)

If your dApp *requires* a specific chain, you can use the small helper `ensureChain()`.
It checks the current chain and only calls `switchChain()` when a change is actually needed.

It returns:

- `true` if it initiated a switch (i.e. the wallet will show an approval prompt)
- `false` if you were already on the desired chain

```ts
import {
  createDuskWallet,
  ensureChain,
  DUSK_CHAIN_PRESETS,
} from "@dusk-network/connect";

const wallet = createDuskWallet();
await wallet.connect();

// Ensure Testnet (only prompts if not already on testnet)
await ensureChain(wallet, { chainId: DUSK_CHAIN_PRESETS.testnet });

// Ensure a custom node (best-effort: compares against the wallet-emitted nodeUrl when available)
await ensureChain(wallet, { nodeUrl: "https://my.custom.node:9000" });

// If you really want to enforce the exact nodeUrl string (when available):
await ensureChain(wallet, { nodeUrl: "https://my.custom.node:9000" }, { strictNodeUrl: true });
```

## Optional connect modal (UI)

If you want a quick, drop-in "connect" flow (Reown/AppKit-style, but tiny):

```ts
import { createDuskConnectKit } from "@dusk-network/connect/ui";

const kit = createDuskConnectKit({
  modal: {
    appName: "My dApp",
    installUrl: "https://chrome.google.com/webstore/detail/<YOUR-EXTENSION-ID>",
  },
});

document.getElementById("connect")!.addEventListener("click", () => {
  kit.open();
});

// You can still use the full SDK via kit.wallet
kit.subscribe((state) => console.log(state));
```

## WalletConnect-style connect button (UI)

If you want the common “Connect Wallet” button UX, the SDK ships a small web component:

```html
<dusk-connect-button
  app-name="My dApp"
  install-url="https://chrome.google.com/webstore/detail/<YOUR-EXTENSION-ID>"
  variant="solid"
></dusk-connect-button>
```

Then wire it to a wallet instance (so your dApp and the button share the same state):

```ts
import { createDuskWallet } from "@dusk-network/connect";
import { defineDuskConnectButton } from "@dusk-network/connect/ui";

defineDuskConnectButton();

const wallet = createDuskWallet();
await wallet.ready();

const btn = document.querySelector("dusk-connect-button");
if (btn) btn.wallet = wallet;
```

The button opens the same connect modal on click.

It emits a single DOM event (bubbling) to make integration easy:

- `dusk-state` (detail: full wallet state)

If you want higher-level semantics like “connected / disconnected”, compare successive `dusk-state` payloads or subscribe to `wallet.subscribe(...)`.

### Theming (UI)

The connect UI is skinnable via **CSS variables**.

All tokens are **namespaced** to avoid collisions with host dApps:

- `--mconnect-*`

You can override them globally (affects modal + button):

```css
:root {
  --mconnect-primary: #7aa2ff;
  --mconnect-background: #05070c;
  --mconnect-foreground: rgba(255,255,255,0.92);
  --mconnect-radius: 14px;
}
```

…or scope them to the button only:

```css
dusk-connect-button {
  --mconnect-primary: #9b7bff;
}
```

Commonly useful tokens:

- `--mconnect-primary`, `--mconnect-ring`, `--mconnect-destructive`
- `--mconnect-background`, `--mconnect-foreground`, `--mconnect-border`
- `--mconnect-radius`, `--mconnect-shadow`


## Script tag (ES module)

You can use the compiled ESM build directly in a browser with `type="module"`.

Example (served from your own site):

```html
<script type="module">
  import { createDuskWallet, parseDuskToLux } from "./dist/index.js";

  const wallet = createDuskWallet();
  await wallet.ready();

  if (!wallet.state.installed) {
    console.log("Dusk Wallet not installed");
  } else {
    await wallet.connect();
    await wallet.sendTransfer({ to: "<base58>", amount: parseDuskToLux("1") });
  }
</script>
```

## Build

```bash
npm run build
```

Produces ESM + types in `dist/`.
