# L1StandardBridge demo (Dusk Wallet SDK)

A minimal example page for interacting with the **StandardBridge** contract using:

- `createDuskApp()` (SDK dApp layer)
- a local browser-friendly `data_driver.wasm` (W3sper-style)
- `contract.call.*` for reads
- `contract.write.*` + `tx.onStatus()` + `tx.wait()` for clean write UX

## Quick start

1) Put your compiled StandardBridge driver at:

```
public/data_driver.wasm
```

2) Install + run:

```bash
npm i
npm run dev
```

3) Open the page and set config (or pass query params).

## Config via query params

Example:

```
?contractId=0xYOUR_32B_CONTRACT_ID
&driverUrl=/data_driver.wasm
&nodeUrl=https://testnet.nodes.dusk.network
&network=testnet
```

The “Apply & reload” button writes these params for you.

## Node load note (important)

This demo intentionally **does not poll** reads.

- Click **Refresh (light)** to load a small set of getters (sequentially).
- Click **Refresh (full)** only when needed (it makes more calls).

If your node is sensitive, keep using the light refresh and avoid repeated refresh clicks.

## Adds you can do in 30 seconds

- Add more getters to `syncFull()` (but be mindful of node load).
- Add more setters by calling:
  - `c.write.set_u64({ DepositFee: 42n })` etc.
  - `c.write.set_evm_address_or_offset({ OtherBridge: "0x..." })` etc.

If you see `Unsupported("fn_name X")`, you’re serving the wrong driver or it’s cached.