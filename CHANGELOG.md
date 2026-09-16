# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Added validated conversion between Base58 Moonlight accounts and `0x` public-key hex [#92].
- Added opt-in `./typed-data` hashing exports backed by `@dusk/typed-data` [wallet#22].
- Added opt-in `./bls` verification with a required chain/origin policy and structured result [wallet#22].

### Changed

- Pinned the shared typed-data RC through JSR's npm compatibility registry for reproducible installs [wallet#22].
- **Breaking:** Removed signer resource limits from `./typed-data`; use `@dusk/typed-data/policy` instead [typed-data#2].
- Required explicit choice for unmatched saved preferences or `preferredProviderId` [#42].
- Made `TxWaitReceipt.ok` nullable for unrecognized execution payloads [#26].
- Separated per-page discovery UUIDs from saved product preferences, with legacy-ID compatibility [#42].

### Fixed

- Stopped assigning SDK-owned wallet branding from self-reported discovery metadata; kept curated installation choices separate [#46].
- Discard delayed profile and shielded-address responses after disconnect without disabling provider events [#37].
- Preserve valid overlapping connections and reads in an unchanged wallet session [#37].
- Keep refresh results current across authorization and profile changes [#37].
- Prevent stale refresh results from overwriting newer chain/node events [#38].
- Coalesce overlapping refreshes within the same wallet context [#38].
- Declared optional typed-data signing support and protocol versions in provider capabilities [wallet#22].
- Cleared metadata-less explicit providers participating in UUID conflicts, including during discovery initialization [#42].
- Kept caller-supplied metadata from creating discovery conflicts [#42].
- Preserved explicit constructor selections when saved product hints become ambiguous [#42].
- Preserved brace-prefixed legacy provider preferences [#42].
- Made live transaction waits race-safe, exact, and retryable [#27].
- Bound asynchronous wallet operations and contract writes to the selected provider [#24].
- Prevented contract proxy facets from being treated as promises [#28].
- Reported unsupported transaction execution payloads as unknown instead of successful [#26].
- Replaced first/last-wins UUID collisions with visible, unselectable conflict entries [#25], [#42].

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

[#46]: https://github.com/dusk-network/connect/issues/46
[#38]: https://github.com/dusk-network/connect/issues/38
[#37]: https://github.com/dusk-network/connect/issues/37
[typed-data#2]: https://github.com/dusk-network/typed-data/issues/2
[wallet#22]: https://github.com/dusk-network/wallet/issues/22
[#42]: https://github.com/dusk-network/connect/issues/42
[#28]: https://github.com/dusk-network/connect/issues/28
[#27]: https://github.com/dusk-network/connect/issues/27
[#26]: https://github.com/dusk-network/connect/issues/26
[#25]: https://github.com/dusk-network/connect/issues/25
[#24]: https://github.com/dusk-network/connect/issues/24
[#92]: https://github.com/dusk-network/wallet/issues/92

[Unreleased]: https://github.com/dusk-network/connect/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/dusk-network/connect/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/dusk-network/connect/releases/tag/v0.1.0
