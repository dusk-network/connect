# Dusk Wallet Discovery Standard

This document defines the canonical browser discovery flow for Dusk wallets.

If you want an implementer-oriented walkthrough with a minimal provider fixture,
see [wallet-implementer.md](./wallet-implementer.md).

The goal is simple:

- allow multiple Dusk wallets to coexist on the same page
- avoid global singleton races such as `window.dusk`
- keep the selected wallet provider EIP-1193-like once discovery is complete

## Overview

Dusk wallet discovery is **event-based**.

- dApps dispatch `dusk:requestProvider`
- wallets respond by dispatching `dusk:announceProvider`
- announcement payloads contain `{ info, provider }`

Discovery is intentionally separate from the provider RPC surface. A dApp should first discover wallets, then select one provider, and only then call `provider.request(...)`.

## Events

- `dusk:requestProvider`
- `dusk:announceProvider`

### `dusk:requestProvider`

dApps dispatch this event on `window` whenever they want wallets to announce themselves.

```js
window.dispatchEvent(new Event("dusk:requestProvider"));
```

Wallets must listen for this event and reply with a fresh `dusk:announceProvider` event every time it is fired.

### `dusk:announceProvider`

Wallets dispatch this event on `window` to announce an available provider.

```js
window.dispatchEvent(
  new CustomEvent("dusk:announceProvider", {
    detail: {
      info,
      provider,
    },
  })
);
```

The announcement payload is:

```ts
type DuskProviderDetail = {
  info: DuskProviderInfo;
  provider: DuskProvider;
};
```

## Wallet Metadata

`detail.info` must include these fields:

- `uuid`
- `name`
- `icon`
- `rdns`

Expected semantics:

- `uuid`: stable wallet identifier used for de-duplication and persisted selection
- `name`: human-readable wallet name shown in pickers
- `icon`: URL or data URI usable in wallet selection UIs
- `rdns`: reverse-DNS identifier such as `network.dusk.wallet`

Wallets should keep `uuid` stable across page loads and product versions. dApps should de-duplicate discovered wallets by `uuid`.

## Provider Contract

The announced `provider` should expose the Dusk provider API:

- `request({ method, params })`
- `on`, `once`, `off`, `removeListener`, `removeAllListeners`
- `enable()`
- `isConnected()`
- `chainId`
- `selectedAddress`
- `isAuthorized`
- `isDusk === true`

RPC methods remain Dusk-prefixed:

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

## Selection Rules

dApps must not rely on wallet injection order.

Recommended behavior:

- if zero wallets are discovered, show install/help UI
- if exactly one wallet is discovered, auto-select it
- if multiple wallets are discovered, require explicit user selection
- persist the last selected wallet keyed by `info.uuid` if desired

dApps should not silently switch providers after the user has selected one.

## Load-Order Rules

To avoid race conditions:

- wallets should announce once on load when practical
- wallets must also re-announce on every `dusk:requestProvider`
- dApps should dispatch `dusk:requestProvider` whenever they start discovery

This makes discovery work whether the wallet or the dApp loads first.

## Wallet Example

```js
const info = {
  uuid: "wallet.example",
  name: "Example Wallet",
  icon: "data:image/svg+xml,...",
  rdns: "com.example.wallet",
};

const provider = { isDusk: true, request() {}, on() {}, off() {} };

const announce = () => {
  window.dispatchEvent(
    new CustomEvent("dusk:announceProvider", {
      detail: { info, provider },
    })
  );
};

window.addEventListener("dusk:requestProvider", announce);
announce();
```

## dApp Example

```js
const providers = new Map();

window.addEventListener("dusk:announceProvider", (event) => {
  const { info, provider } = event.detail;
  providers.set(info.uuid, { info, provider });
});

window.dispatchEvent(new Event("dusk:requestProvider"));

if (providers.size === 1) {
  const [{ provider }] = [...providers.values()];
  await provider.request({ method: "dusk_requestAccounts" });
}
```
