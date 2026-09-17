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
- `icon`: image data URI recommended for wallet selection UIs
- `rdns`: stable, self-attested product identifier such as `network.dusk.wallet`

Wallets MUST generate a fresh UUIDv4 for each provider instance/page, and MUST
reuse that UUID and provider object on subsequent announcements. Do not reuse a
product constant, or regenerate the UUID on each request event. This follows
[EIP-6963's session UUID convention](https://eips.ethereum.org/EIPS/eip-6963).
`crypto.randomUUID()` is suitable in secure contexts; extension injection on HTTP
pages can use `crypto.getRandomValues()` with UUIDv4 version/variant bits instead.
A wallet's internal bridge routing identifier is separate from its discovery UUID.

The Connect modal renders only image data URIs (`data:image/...`) in `<img>`
elements, including SVG. Other icon values use a generic initial so listing a
provider does not fetch its remote icon. Discovery still retains the original
icon string and keeps the provider selectable; custom pickers should apply the
same rendering policy.

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

dApps must not treat wallet injection or announcement order as proof of identity.

Recommended behavior:

- if zero wallets are discovered, show install/help UI
- if exactly one wallet UUID is discovered, its retained provider may be auto-selected
- if multiple wallets are discovered, require explicit selection or an unambiguous saved product hint
- persist `rdns` as a product preference if desired, never a session UUID as product identity

Collectors and wrappers MUST retain the first valid provider object and metadata
received for each UUID and ignore later announcements with that UUID, including
metadata changes from the same object. Duplicate claims MUST NOT replace,
disable or disconnect the retained entry. It remains selectable before and after
any collision. This matches [MIPD's first-seen UUID handling](https://github.com/wevm/mipd/blob/0fda4481a31a28a4571c10a1d99568c9b4fed226/src/store.ts#L51-L70),
not a requirement imposed by EIP-6963 itself.

`requestDuskProviders()` retains entries for one collection cycle; a `DuskWallet`
retains them for its lifetime, including across explicit rediscovery requests.
Raw `subscribeDuskProviders()` listeners receive all valid announcements and must
apply their own retention policy. A one-shot collection is not a lifetime monitor.
The deprecated `DuskProviderInfo.conflicted` field is ignored and never emitted.
The modal does not show collision warnings or disable duplicate-UUID entries;
its notice that all discovered branding is self-reported remains.

Once selected, the provider object remains the request/event target regardless
of later discovery, whether selected automatically, explicitly or supplied to the
constructor. Constructor metadata is registered before initial discovery; a
metadata-less supplied object never adopts another object's retained metadata.
Duplicate announcements do not change selection/network epochs or invalidate
pending RPCs. Explicit switches still replace the object and invalidate stale
work normally; disconnect/lock keep their existing permission/session semantics,
and destruction stops the wrapper. Reconnection uses the existing object.

First received does not mean genuine: an earlier page listener can synchronously
emit a forgery that reaches discovery before the genuine announcement it copied.
First-wins deliberately accepts that discovery limitation rather than allowing
a later claimant to disable an entry. Neither selecting a provider nor keeping
its object establishes wallet-brand authenticity or grants permission. Wallet
approval and application-level verification remain separate.

Initialize provider discovery early (for example, by calling `createDuskWallet()`),
before third-party page scripts where practical; this is best-effort load-order
guidance, not wallet authentication.

Connect stores `selectProvider()` product choices as `{ "version": 1, "rdns": "…" }` under
`dusk.connect.selectedProvider` (or `providerStorageKey`). A saved product hint
restores only when exactly one discovered entry matches at selection time.
Additional product matches arriving later do not clear that selection.
Constructor-supplied `provider`/`providerInfo` ignore stored preferences.
Distinct UUIDs sharing an `rdns` remain separate entries, not verified identities.
Legacy raw-ID preferences still match an existing UUID; values that
are not valid version-1 product records remain raw IDs, including brace-prefixed
IDs. The next explicit selection writes the new format. Unmatched legacy IDs
cannot identify a new session. An unmatched saved preference or current-page
`preferredProviderId` leaves selection empty until a match arrives or the user
chooses another instance with `selectProvider(uuid)`; it does not select an
unrelated lone provider. Without a preference, a lone retained provider can
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
// With multiple entries, use a wallet picker / Connect modal.
// Pass the user's chosen current-page UUID to selectProvider().
if (!wallet.provider) throw new Error("Select a wallet first");
await wallet.connect();
```
