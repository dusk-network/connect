# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Clarified that Dusk Connect is published as `@dusk/connect` on JSR and that npm publishing is intentionally separate.

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

[Unreleased]: https://github.com/dusk-network/connect/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/dusk-network/connect/releases/tag/v0.1.0
