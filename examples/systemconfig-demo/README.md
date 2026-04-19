# SystemConfig demo (Dusk Connect)

A minimal example page for interacting with Optimism's **SystemConfig** contract (ported to a Dusk contract) using:

- `createDuskApp()` (SDK dApp layer)
- a local browser-friendly `data_driver.wasm` (W3sper-style)
- `contract.call.*` for reads
- `contract.write.*` + `tx.onStatus()` + `tx.wait()` for clean write UX

## Quick start

1) Put your compiled **SystemConfig** driver at:

```
public/data_driver.wasm
```

2) Serve the SDK root with any static server:

```bash
cd /path/to/connect
npm install
npm run build

# option A (Python)
python3 -m http.server 5173

# option B (Node)
npx serve . -l 5173
```

3) Open:

```
http://localhost:5173/examples/systemconfig-demo/
```

Then set config (or pass query params).

## Config via query params

Example:

```
?contractId=0xYOUR_32B_CONTRACT_ID
&driverUrl=./public/data_driver.wasm
&nodeUrl=https://testnet.nodes.dusk.network
&network=testnet
```

The “Apply & reload” button writes these params for you.

## Node load note (important)

This demo intentionally **does not poll** reads.

- Click **Refresh (light)** to load a small set of getters (sequentially).
- Click **Refresh (full)** only when needed (it makes more calls).

If your node is sensitive, keep using the light refresh and avoid repeated refresh clicks.

## Common issues

- **`Unsupported("fn_name X")`** → you're serving the wrong `data_driver.wasm` (or it's cached). During dev, keep using cache-busting like `?v=${Date.now()}`.
- If the driver fails to load, the UI will show: `driver load error: ...`.
