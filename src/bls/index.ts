/**
 * Dusk BLS12-381 short-signature verification for typed-data v1 (opt-in).
 *
 * This entrypoint is not part of the root `@dusk/connect` export - import it
 * explicitly from `@dusk/connect/bls` when a verifier (a relayer, a dApp
 * backend, tests) needs to check a Dusk typed-data v1 signature.
 *
 * @example
 * ```ts
 * import { verifyTypedDataSignature } from "@dusk/connect/bls";
 * ```
 *
 * @module
 */

export type { HashTypedDataInput } from "@dusk/typed-data";
export type {
  TypedDataVerificationPolicy,
  TypedDataVerificationCode,
  TypedDataVerificationResult,
} from "@dusk/typed-data/bls";
export { BLS_SIGN_DST, TYPED_DATA_SIG_TAG, verifyTypedDataSignature, verifyBlsDigest } from "@dusk/typed-data/bls";
