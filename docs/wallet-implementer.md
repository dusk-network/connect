# Dusk Wallet Implementer Guide

This guide is for wallet teams that want to expose a Dusk provider compatible
with `@dusk-network/connect` and the v0.1 Dusk Wallet provider API.

Canonical source ownership:

- Discovery protocol: [wallet-discovery.md](./wallet-discovery.md)
- Provider API: [dusk-network/wallet docs/provider-api.md](https://github.com/dusk-network/wallet/blob/main/docs/provider-api.md)
- Security/threat model: [dusk-network/wallet docs/SECURITY.md](https://github.com/dusk-network/wallet/blob/main/docs/SECURITY.md)
- Runnable SDK fixture: `examples/reference-wallet/`
- SDK conformance coverage: `src/wallet-implementer.integration.test.ts`

Discovery is event-based:

- wallets listen for `dusk:requestProvider`
- wallets answer with `dusk:announceProvider`
- the announced provider exposes an EIP-1193-like object with Dusk RPC methods

The canonical discovery event spec lives in
[wallet-discovery.md](./wallet-discovery.md).

## Required Discovery Events

- `dusk:requestProvider`
- `dusk:announceProvider`

## Wallet Metadata

`detail.info` must include:

- `uuid`
- `name`
- `icon`
- `rdns`

`uuid` should be stable across product versions and page loads. `rdns` should
identify the wallet product, for example `com.example.wallet`.

## Provider Surface

The announced provider should expose:

- `request({ method, params })`
- `on(eventName, handler)`
- `once(eventName, handler)`
- `off(eventName, handler)`
- `removeListener(eventName, handler)`
- `removeAllListeners(eventName?)`
- `isConnected()`
- `chainId`
- `profiles`
- `isAuthorized`
- `isDusk === true`

Profiles are the provider identity model. A profile contains the public account
and may include the explicitly approved shareable shielded receive address:

```ts
type DuskProfile = {
  profileId: string;
  account: string;
  shieldedAddress?: string;
};
```

## RPC Method Summary

The wallet repo's provider API is the canonical source for method parameters,
permissions, errors, and limits. Wallets should expose these v0.1 methods:

- `dusk_getCapabilities`
- `dusk_requestProfiles`
- `dusk_profiles`
- `dusk_requestShieldedAddress`
- `dusk_chainId`
- `dusk_switchNetwork`
- `dusk_getPublicBalance`
- `dusk_estimateGas`
- `dusk_sendTransaction`
- `dusk_watchAsset`
- `dusk_signMessage`
- `dusk_signAuth`
- `dusk_disconnect`

## Event Semantics

If your wallet supports connection state changes, emit:

- `connect`
- `disconnect`
- `profilesChanged`
- `chainChanged`
- `duskNodeChanged`

Recommended behavior:

- emit `connect` after a successful `dusk_requestProfiles`
- emit `profilesChanged` when visible profile fields change
- emit `profilesChanged([])` when the wallet is locked or no profile fields are visible
- emit `chainChanged` when the active CAIP-2 chain id changes
- emit `duskNodeChanged` when the selected node or network details change
- emit `disconnect` when the origin loses authorization or the wallet disconnects

`profilesChanged([])` is not necessarily a permission revoke. It may also mean
the wallet is locked. Use `disconnect` for explicit disconnection or permission
loss.

## Minimal Reference Injection

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
let chainId = "dusk:2";
const profile = {
  profileId: "profile:0",
  account: "dusk1example...",
};
const shieldedAddress = "dusk1shielded...";

function visibleProfiles(includeShielded = false) {
  if (!authorized) return [];
  return [
    {
      ...profile,
      ...(includeShielded ? { shieldedAddress } : {}),
    },
  ];
}

const provider = {
  isDusk: true,
  get chainId() {
    return chainId;
  },
  get profiles() {
    return visibleProfiles();
  },
  get isAuthorized() {
    return authorized;
  },
  isConnected() {
    return true;
  },
  on: events.on,
  off: events.off,
  removeListener: events.off,
  removeAllListeners: events.removeAllListeners,
  once(eventName, handler) {
    const wrapped = (payload) => {
      events.off(eventName, wrapped);
      handler(payload);
    };
    events.on(eventName, wrapped);
  },
  async request({ method, params }) {
    switch (method) {
      case "dusk_getCapabilities":
        return {
          provider: info.rdns,
          walletVersion: "0.0.0",
          chainId,
          nodeUrl: "https://testnet.nodes.dusk.network",
          networkName: "Testnet",
          methods: [
            "dusk_getCapabilities",
            "dusk_requestProfiles",
            "dusk_profiles",
            "dusk_requestShieldedAddress",
            "dusk_chainId",
            "dusk_switchNetwork",
            "dusk_getPublicBalance",
            "dusk_estimateGas",
            "dusk_sendTransaction",
            "dusk_watchAsset",
            "dusk_signMessage",
            "dusk_signAuth",
            "dusk_disconnect",
          ],
          txKinds: ["transfer", "contract_call"],
          limits: {
            maxFnArgsBytes: 65536,
            maxFnNameChars: 64,
            maxMemoBytes: 512,
          },
          features: {
            shieldedRead: false,
            shieldedRecipients: true,
            shieldedReceiveAddress: true,
            signMessage: true,
            signAuth: true,
            contractCallPrivacy: true,
            watchAsset: true,
          },
        };

      case "dusk_requestProfiles": {
        authorized = true;
        const includeShielded = Boolean(params?.shieldedReceiveAddress);
        const profiles = visibleProfiles(includeShielded);
        events.emit("connect", { chainId });
        events.emit("profilesChanged", profiles);
        return profiles;
      }

      case "dusk_profiles":
        return visibleProfiles();

      case "dusk_requestShieldedAddress":
        authorized = true;
        return {
          address: shieldedAddress,
          account: profile.account,
          profileId: profile.profileId,
          chainId,
        };

      case "dusk_chainId":
        return chainId;

      case "dusk_disconnect":
        authorized = false;
        events.emit("disconnect", { code: 4900, message: "Disconnected" });
        events.emit("profilesChanged", []);
        return true;

      default:
        throw Object.assign(new Error(`Unsupported method: ${method}`), { code: 4200 });
    }
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

## Conformance Helper

Wallet repositories can run the reusable Connect conformance helper in a
browser-like test environment:

```ts
import { runWalletConformance } from "@dusk-network/connect/testing";

await runWalletConformance({
  installWallet(window) {
    // install your provider into the supplied window
  },
  expectedProvider: {
    rdns: "com.example.wallet",
  },
});
```

The helper checks discovery, profile connection, passive profile reads,
capabilities, chain switching, and basic provider events.

The runnable browser example lives at `examples/reference-wallet/`. The matching
repository integration test is `src/wallet-implementer.integration.test.ts`.
