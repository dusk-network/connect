# Dusk Typed Data

Connect exposes hashing through `@dusk/connect/typed-data` and signature verification through `@dusk/connect/bls`. Both delegate to [`@dusk/typed-data`](https://github.com/dusk-network/typed-data); the root SDK loads no cryptography.

- [Protocol specification](https://github.com/dusk-network/typed-data/blob/main/docs/typed-data-v1.md)
- [Hashing and verification examples](https://github.com/dusk-network/typed-data#readme)

Verification requires a trusted `{ chainId, origin }` policy and returns a structured result. Check `result.ok`, not the truthiness of the object. Applications must also check signer identity, authorization and replay/expiry rules. Bare-digest verification is not typed-data verification.

Signer resource checks are deliberately separate: import `checkPolicyLimits` from `@dusk/typed-data/policy`, not `@dusk/connect/typed-data`. They do not define digest validity; verifiers must support otherwise-valid inputs within the spec's floor and may decline larger requests at their transport boundary.

The shared library owns the encoder, BLS verifier, generators and vectors. Its [provenance](https://github.com/dusk-network/typed-data/blob/main/PROVENANCE.md) preserves ichbindas's original work from [Connect #35](https://github.com/dusk-network/connect/pull/35); this integration does not need that PR merged first.

**Draft, not frozen.** The integration currently pins unpublished `0.1.0-next.0`. Package publication and registry-backed lockfiles are required before merge/release. Passing integration tests does not independently certify the encoding.
