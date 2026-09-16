# Dusk Wallet Discovery Standard

This document is the canonical browser discovery protocol for Dusk wallets.
It deliberately does not duplicate the provider RPC specification. The
provider API is owned by
[dusk-network/wallet docs/provider-api.md](https://github.com/dusk-network/wallet/blob/main/docs/provider-api.md).

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

- `uuid`: random UUIDv4 identifying one provider instance for the current page
- `name`: human-readable wallet name shown in pickers
- `icon`: URL or data URI usable in wallet selection UIs
- `rdns`: stable, self-attested product identifier such as `network.dusk.wallet`

Wallets MUST generate a fresh UUIDv4 for each provider instance/page, and MUST
reuse that UUID and provider object on subsequent announcements. Do not reuse a
product constant, or regenerate the UUID on each request event. This follows
[EIP-6963's session UUID convention](https://eips.ethereum.org/EIPS/eip-6963).
`crypto.randomUUID()` is suitable in secure contexts; extension injection on HTTP
pages can use `crypto.getRandomValues()` with UUIDv4 version/variant bits instead.
A wallet's internal bridge routing identifier is separate from its discovery UUID.

Neither UUID, `rdns`, name nor icon authenticates a wallet. All announcement
metadata is self-attested; matching a familiar product string is not proof of
ownership or a substitute for application authorization. The Connect modal renders
all discovered providers uniformly: their supplied icon or a generic initial,
without substituting SDK-owned artwork based on product-like metadata. Its
self-reporting notice does not prevent lookalike names or icons. Curated install
links/artwork belong to the separate missing-wallet installation flow and do not
endorse a discovered provider.

## Provider Summary

Discovery only hands the dApp a provider object. The current v0.1 provider
identity model is profile-based:

- connect with `dusk_requestProfiles`
- read current grants with `dusk_profiles`
- listen for `profilesChanged`
- request a `shieldedAddress` only through explicit user approval

The provider should expose:

- `request({ method, params })`
- `on`, `once`, `off`, `removeListener`, `removeAllListeners`
- `isConnected()`
- `chainId`
- `profiles`
- `isAuthorized`
- `isDusk === true`

See the wallet repo's
[provider API](https://github.com/dusk-network/wallet/blob/main/docs/provider-api.md)
for the canonical method, event, error, permission, and limit definitions.

## Selection Rules

dApps must not rely on wallet injection order.

Recommended behavior:

- if zero wallets are discovered, show install/help UI
- if exactly one non-conflicting wallet is discovered, it may be auto-selected
- if multiple wallets are discovered, require explicit selection or an unambiguous saved product hint
- persist `rdns` as a product preference if desired, never a session UUID as product identity

The same UUID and same provider object may update display metadata. Distinct
provider objects claiming the same UUID are a conflict, not first-wins or
last-wins ownership: dApps MUST make the conflict visible and MUST NOT select
that UUID. Do not silently switch to another provider after a collision.

The Connect collector and wrapper expose a single diagnostic entry with
`info.conflicted: true`, retaining the first object's metadata for display only.
The collector remembers conflicts for its collection cycle; the wrapper retains
them for its lifetime, clears a conflicting selection through its existing
selection-change handling, and refuses selection of that UUID. Re-announcements
cannot clear a conflict. This also applies to constructor-supplied providers without
`providerInfo`: once observed claiming a conflicted UUID, their selection is cleared
regardless of announcement order, including during initialization. Explicit providers
not observed participating in the conflict remain usable.
Caller-supplied `conflicted` metadata cannot create a conflict, including with an
explicit `providerInfo`. The optional modal displays
and disables conflicted entries. Raw-provider users must handle later
announcements/selection changes; a one-shot collector is not a lifetime monitor or an authentication mechanism.

Connect stores explicit product choices as `{ "version": 1, "rdns": "…" }` under
`dusk.connect.selectedProvider` (or `providerStorageKey`). A saved product hint
restores only when exactly one discovered entry matches; a later duplicate
match clears automatic restoration, but not an explicit instance choice (including
constructor-supplied `provider`/`providerInfo`, which ignore stored preferences).
Legacy raw-ID preferences still match an existing unconflicted UUID; values that
are not valid version-1 product records remain raw IDs, including brace-prefixed
IDs. The next explicit selection writes the new format. Unmatched legacy IDs
cannot identify a new session. An unmatched saved preference or current-page
`preferredProviderId` leaves selection empty until a match arrives or the user
chooses another instance with `selectProvider(uuid)`; it does not select an
unrelated lone provider. Without a preference, a lone unconflicted provider can
still auto-select. `rememberLastUsedProvider: false` disables storage reads and
writes. Legacy non-UUID identifiers remain accepted for interoperability, but
new wallet implementations must follow the UUIDv4 rule above.

Discovery is not authentication, and dApps should not silently switch providers
after the user has selected one.

## Load-Order Rules

To avoid race conditions:

- wallets should announce once on load when practical
- wallets must also re-announce on every `dusk:requestProvider`
- dApps should dispatch `dusk:requestProvider` whenever they start discovery

This makes discovery work whether the wallet or the dApp loads first.

## Wallet Example

```js
const info = {
  uuid: crypto.randomUUID(), // Generate once, not inside announce().
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
import { createDuskWallet } from "@dusk/connect";

const wallet = createDuskWallet();
await wallet.ready();
// With multiple or conflicted entries, use a wallet picker / Connect modal.
// Pass the user's chosen unconflicted current-page UUID to selectProvider().
if (!wallet.provider) throw new Error("Select an unconflicted wallet first");
await wallet.connect();
```
