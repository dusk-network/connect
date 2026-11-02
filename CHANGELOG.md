# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-11-02

### Added

- Added optional `DuskProfile.name`, a canonical `.dusk` name that the connect button and modal show in place of the shortened account [#56].
- Added `expectedName` to `runWalletConformance` [#56].
- Added read-only `wallet.initializing` to distinguish pending initialization from a settled success or failure [#44].
- Added opt-in `pinnedNodeUrl` for app reads without changing the existing `nodeUrl` fallback semantics or the wallet's transaction network [#44].
- Added `TxHandle.origin` and `DuskWalletProviderChangedError` [#24].
- Added configurable `providerReadTimeoutMs` (default 10 seconds) and `DuskWalletRequestTimeoutError` for non-interactive provider reads, including initial readiness [#44].
- Added validated conversion between Base58 Moonlight accounts and `0x` public-key hex [#92].
- Added `drcPrincipal()` to build a DRC principal from a Moonlight account or a contract id [#51].
- Added opt-in `./typed-data` hashing exports backed by `@dusk/typed-data` [wallet#22].
- Added opt-in `./bls` verification with a required chain/origin policy and structured result [wallet#22].
- Added read-only `wallet.sessionEpoch` and `wallet.profilesEpoch` [#53].

### Changed

- **Breaking:** Made the DRC20 helper follow the DRC20 standard in dusk-network/contracts: `DrcPrincipal` accounts, `amount` instead of `value`, the standard's struct arguments and `DRC20_METHOD_SIGS` [#51].
- Made discovery first-wins per UUID, ignoring later objects and metadata without disabling the retained entry [#45].
- Deprecated `DuskProviderInfo.conflicted`, which discovery no longer emits [#45].
- Pinned the shared typed-data RC through JSR's npm compatibility registry for reproducible installs [wallet#22].
- **Breaking:** Required explicit choice for unmatched saved preferences or `preferredProviderId` [#42].
- **Breaking:** Made `TxWaitReceipt.ok` nullable for unrecognized execution payloads [#26].
- **Breaking:** Made `tx.wait()` reject with `DuskTxTrackingUnavailableError` when the transaction's submission node is unknown or isn't the read node [#24].
- Separated per-page discovery UUIDs from saved product preferences, with legacy-ID compatibility [#42].

### Fixed

- Stopped contract writes and `sendTransaction` from sending after the network, session or profiles change while the call is prepared [#53].
- Stopped the wallet picker from fetching announcement-controlled icon URLs by rendering only image data URIs or fallback initials [#49].
- Filled `providerId` when a metadata-less explicit provider later announces its own metadata [#48].
- Kept active provider selections unchanged when later discovery introduces additional product matches [#45].
- Cleared the previous provider's chain snapshot before hydrating a replacement provider [#44].
- Filled `wallet.state.node` from the wallet's capabilities on refresh [#18].
- Stopped replaying settled startup errors into contract writes and chain checks after recovery [#44].
- **Breaking:** Validated node URLs at every wallet state ingress and before node I/O: HTTPS or HTTP on loopback, without credentials, queries or fragments. Invalid provider URLs clear the node snapshot; invalid app URLs throw [#44].
- Guarded chain ID types across provider properties, RPCs and events; made `connect` reread provider state instead of trusting its payload as permission [#44].
- Documented that typed-data capability flags are unvalidated declarations, not enforced signing gates [#44].
- Stopped assigning SDK-owned wallet branding from self-reported discovery metadata; kept curated installation choices separate [#46].
- Discard delayed profile and shielded-address responses after disconnect without disabling provider events [#37].
- Preserve valid overlapping connections and reads in an unchanged wallet session [#37].
- Keep refresh results current across authorization and profile changes [#37].
- Prevent stale refresh results from overwriting newer chain/node events [#38].
- Coalesce overlapping refreshes within the same wallet context [#38].
- Declared optional typed-data signing support and protocol versions in provider capabilities [wallet#22].
- Preserved explicit constructor selections when saved product hints become ambiguous [#42].
- Preserved brace-prefixed legacy provider preferences [#42].
- Made live transaction waits race-safe, exact, and retryable [#27].
- Bound asynchronous wallet operations and contract writes to the selected provider [#24].
- Prevented contract proxy facets from being treated as promises [#28].
- Reported unsupported transaction execution payloads as unknown instead of successful [#26].

## [0.2.0] - 2026-07-04

### Added

- Added curated Connect UI install options for missing-wallet flows, with browser-specific Dusk Wallet and Piewallet choices.
- Added known wallet branding for Dusk Wallet and Piewallet rows in the Connect UI.

### Changed

- Clarified that Dusk Connect is published as `@dusk/connect` on JSR and that npm publishing is intentionally separate.
- Changed the missing-wallet `<dusk-connect-button />` flow to open the Connect modal instead of directly redirecting.

### Removed

- Removed app-provided `installUrl` / `install-url` support from the optional Connect UI so install destinations stay SDK-owned.

## [0.1.0] - 2026-05-28

### Added

- Added the public `@dusk/connect` package metadata and JSR publishing configuration.
- Added the profile-first Dusk Wallet provider client for dApps.
- Added wallet discovery support for Dusk-compatible injected providers.
- Added multi-provider handling so dApps can select a wallet when more than one compatible provider is present.
- Added profile connection helpers for `dusk_requestProfiles`, `dusk_profiles`, `profilesChanged`, and `dusk_disconnect`.
- Added explicit shielded receive-address request support for flows that need shielded payment details.
- Added wallet state helpers for connection status, selected wallet metadata, profiles, watched assets, chain id, and node URL.
- Added `createDuskApp()` as a higher-level integration helper that combines wallet, node, contract, and chain utilities.
- Added Dusk node helpers for GraphQL queries, contract reads, transaction lookup, and transaction execution polling.
- Added contract-call helpers for read, prepare, send, and write flows.
- Added DRC20 and DRC721 helpers for metadata, balances, transfers, approvals, ownership, token URI reads, and watched assets.
- Added amount helpers for Lux/DUSK parsing and formatting.
- Added chain helpers and presets for ensuring a wallet is connected to the expected Dusk network.
- Added optional Connect UI helpers, including the connect modal and `<dusk-connect-button />`.
- Added theming hooks for the optional Connect UI via CSS variables.
- Added testing utilities, mock providers, reference wallet fixtures, and conformance helpers for dApp and wallet implementers.
- Added wallet discovery and wallet implementer documentation for Dusk-compatible injected providers.
- Added v0.1 release hygiene documentation.

### Changed

- Renamed the package to `@dusk/connect`.
- Aligned public examples with the current profile API rather than account-style APIs.
- Refreshed Dusk-themed examples for transfer, contract, discovery, DRC20, and DRC721 integrations.
- Clarified JSR install snippets and package publishing expectations.

### Fixed

- Fixed unsafe provider metadata rendering in example UI.
- Fixed disconnect/revocation state handling in the wallet integration helpers.
- Fixed provider event normalization for profile and chain changes.
- Fixed package contents so published artifacts include the built entrypoints and documentation needed by consumers.

[#56]: https://github.com/dusk-network/connect/issues/56
[#49]: https://github.com/dusk-network/connect/issues/49
[#53]: https://github.com/dusk-network/connect/issues/53
[#48]: https://github.com/dusk-network/connect/pull/48
[#51]: https://github.com/dusk-network/connect/issues/51
[#45]: https://github.com/dusk-network/connect/issues/45
[#44]: https://github.com/dusk-network/connect/issues/44
[#46]: https://github.com/dusk-network/connect/issues/46
[#38]: https://github.com/dusk-network/connect/issues/38
[#37]: https://github.com/dusk-network/connect/issues/37
[wallet#22]: https://github.com/dusk-network/wallet/issues/22
[#42]: https://github.com/dusk-network/connect/issues/42
[#28]: https://github.com/dusk-network/connect/issues/28
[#27]: https://github.com/dusk-network/connect/issues/27
[#26]: https://github.com/dusk-network/connect/issues/26
[#24]: https://github.com/dusk-network/connect/issues/24
[#18]: https://github.com/dusk-network/connect/issues/18
[#92]: https://github.com/dusk-network/wallet/issues/92

[Unreleased]: https://github.com/dusk-network/connect/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/dusk-network/connect/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/dusk-network/connect/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/dusk-network/connect/releases/tag/v0.1.0
