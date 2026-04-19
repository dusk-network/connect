# Dusk Wallet Implementer Guide

This guide is for wallet teams that want to expose a Dusk provider that works
with `@dusk-network/connect` and any dApp that follows the same discovery
standard.

The protocol is intentionally small:

- wallets listen for `dusk:requestProvider`
- wallets answer with `dusk:announceProvider`
- the announced provider exposes an EIP-1193-like object with Dusk RPC methods

If you only implement those pieces correctly, dApps can discover your wallet,
let the user select it, and call `provider.request(...)` without depending on a
global singleton like `window.dusk`.

## Required Discovery Events

- `dusk:requestProvider`
- `dusk:announceProvider`

Your wallet should:

1. create a provider object
2. create stable `info` metadata
3. announce once on load when practical
4. re-announce every time the page dispatches `dusk:requestProvider`

The canonical event spec lives in [wallet-discovery.md](./wallet-discovery.md).

## Wallet Metadata

`detail.info` must include:

- `uuid`
- `name`
- `icon`
- `rdns`

Guidance:

- `uuid` should be stable across product versions and page loads
- `name` should be user-facing
- `icon` should be a usable URL or data URI
- `rdns` should identify the wallet product, for example `com.example.wallet`

## Minimum Provider Surface

At minimum, the announced provider should expose:

- `request({ method, params })`
- `on(eventName, handler)`
- `once(eventName, handler)`
- `off(eventName, handler)`
- `removeListener(eventName, handler)`
- `removeAllListeners(eventName?)`
- `enable()`
- `isConnected()`
- `chainId`
- `selectedAddress`
- `isAuthorized`
- `isDusk === true`

The first three RPC methods a dApp will usually hit are:

- `dusk_getCapabilities`
- `dusk_accounts`
- `dusk_requestAccounts`

The broader Dusk RPC surface is documented in the
[Dusk Wallet provider API](https://github.com/dusk-network/wallet/blob/main/docs/provider-api.md).

## Minimum Event Semantics

If your wallet supports connection state changes, emit these provider events:

- `connect`
- `disconnect`
- `accountsChanged`
- `chainChanged`
- `duskNodeChanged`

Recommended behavior:

- emit `connect` after a successful `dusk_requestAccounts`
- emit `accountsChanged` when the exposed account changes
- emit `chainChanged` when the active CAIP-2 chain id changes
- emit `duskNodeChanged` when the selected node/network details change
- emit `disconnect` when the origin loses authorization or the wallet disconnects

## Minimal Reference Injection

This is the smallest useful pattern to copy into a wallet injection script:

```js
const DUSK_REQUEST_PROVIDER_EVENT = "dusk:requestProvider";
const DUSK_ANNOUNCE_PROVIDER_EVENT = "dusk:announceProvider";

const info = {
  uuid: "com.example.wallet",
  name: "Example Wallet",
  icon: "data:image/svg+xml,...",
  rdns: "com.example.wallet",
};

function createEmitter() {
  const listeners = new Map();

  return {
    on(eventName, handler) {
      const set = listeners.get(eventName) ?? new Set();
      set.add(handler);
      listeners.set(eventName, set);
    },
    off(eventName, handler) {
      listeners.get(eventName)?.delete(handler);
    },
    once(eventName, handler) {
      const wrapped = (payload) => {
        this.off(eventName, wrapped);
        handler(payload);
      };
      this.on(eventName, wrapped);
    },
    emit(eventName, payload) {
      for (const handler of listeners.get(eventName) ?? []) handler(payload);
    },
    removeAllListeners(eventName) {
      if (eventName) listeners.delete(eventName);
      else listeners.clear();
    },
  };
}

const events = createEmitter();
let authorized = false;
let accounts = ["dusk1exampleaccount"];
let chainId = "dusk:2";

const provider = {
  isDusk: true,
  get chainId() {
    return chainId;
  },
  get selectedAddress() {
    return authorized ? accounts[0] ?? null : null;
  },
  get isAuthorized() {
    return authorized;
  },
  async request({ method, params }) {
    switch (method) {
      case "dusk_getCapabilities":
        return {
          provider: info.rdns,
          walletVersion: "1.0.0",
          chainId,
          nodeUrl: "https://testnet.nodes.dusk.network",
          networkName: "Testnet",
          methods: ["dusk_getCapabilities", "dusk_accounts", "dusk_requestAccounts"],
          txKinds: ["transfer", "contract_call"],
          limits: { maxFnArgsBytes: 65536, maxFnNameChars: 64, maxMemoBytes: 512 },
          features: {
            shieldedRead: false,
            shieldedRecipients: true,
            signMessage: true,
            signAuth: true,
            contractCallPrivacy: true,
            watchAsset: true,
          },
        };

      case "dusk_accounts":
        return authorized ? [...accounts] : [];

      case "dusk_requestAccounts":
        authorized = true;
        events.emit("connect", { chainId });
        events.emit("accountsChanged", [...accounts]);
        return [...accounts];

      case "dusk_chainId":
        return chainId;

      default:
        throw Object.assign(new Error(`Unsupported method: ${method}`), { code: 4200 });
    }
  },
  on: events.on.bind(events),
  once: events.once.bind(events),
  off: events.off.bind(events),
  removeListener: events.off.bind(events),
  removeAllListeners: events.removeAllListeners.bind(events),
  enable() {
    return this.request({ method: "dusk_requestAccounts" });
  },
  isConnected() {
    return true;
  },
};

function announce() {
  window.dispatchEvent(
    new CustomEvent(DUSK_ANNOUNCE_PROVIDER_EVENT, {
      detail: { info, provider },
    })
  );
}

window.addEventListener(DUSK_REQUEST_PROVIDER_EVENT, announce);
announce();
```

## Reference Artifacts In This Repository

If you want something runnable instead of a prose guide, this repository now
includes:

- `examples/reference-wallet/`
- `src/test/referenceWallet.ts`
- `src/wallet-implementer.integration.test.ts`

The example page demonstrates a minimal wallet injection talking to a dApp that
uses `createDuskWallet()`. The test fixture and integration test show the same
pattern in executable form.

## Conformance Snippet

Wallet implementers can use this as a starting point in their own repo:

```ts
import { describe, expect, it } from "vitest";
import { createDuskWallet } from "@dusk-network/connect";

describe("wallet injection", () => {
  it("is discoverable and connectable", async () => {
    const wallet = createDuskWallet({
      preferredProviderId: "com.example.wallet",
    });

    await wallet.ready();

    expect(wallet.state.installed).toBe(true);
    expect(wallet.state.providerId).toBe("com.example.wallet");

    const accounts = await wallet.connect();

    expect(accounts.length).toBeGreaterThan(0);
    expect(wallet.state.chainId).toMatch(/^dusk:/);
    expect(wallet.state.authorized).toBe(true);
  });
});
```

## Practical Rules

- Do not inject a `window.dusk` singleton as the canonical integration path.
- Do not depend on injection order.
- Keep `uuid` stable and unique.
- Re-announce on every `dusk:requestProvider`.
- Return empty arrays, not errors, for `dusk_accounts` when the origin is not connected.
- Use typed RPC errors when rejecting (`4001`, `4100`, `4200`, `4900`).
