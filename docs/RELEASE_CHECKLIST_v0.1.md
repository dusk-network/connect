# v0.1 Release Checklist

This is the canonical Dusk Wallet + Connect v0.1 release checklist. It links to
the owner docs instead of restating their full specifications.

## Canonical Docs

- [ ] Wallet provider API is current in `dusk-network/wallet/docs/provider-api.md`.
- [ ] Discovery protocol is current in `dusk-network/connect/docs/wallet-discovery.md`.
- [ ] Connect SDK usage is current in `dusk-network/connect/README.md`.
- [ ] Wallet implementer guidance is current in `dusk-network/connect/docs/wallet-implementer.md`.
- [ ] Security/threat model is current in `dusk-network/wallet/docs/SECURITY.md`.

## Provider Surface

- [ ] Public docs use `dusk_requestProfiles`, `dusk_profiles`, and `profilesChanged`.
- [ ] `shieldedAddress` is documented as present only after explicit approval.
- [ ] Deprecated account-style APIs are absent from v0.1 examples or clearly marked deprecated.
- [ ] Wallet `providerSurface` constants, provider docs, Connect README, and conformance tests agree on RPC methods.
- [ ] Error codes, permissions, limits, and event names match the wallet provider API.

## Verification

- [ ] Wallet conformance tests pass.
- [ ] Connect conformance tests pass.
- [ ] Wallet build passes for supported extension targets.
- [ ] Connect build passes and generated types match source.
- [ ] Remaining v0.1 ambiguities are listed in the release notes or final audit report.
