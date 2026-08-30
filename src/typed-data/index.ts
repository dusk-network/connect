/**
 * Dusk typed-data v1 hashing (opt-in).
 *
 * This entrypoint is not part of the root `@dusk/connect` export - import it
 * explicitly from `@dusk/connect/typed-data` when a dApp or wallet needs to
 * compute or verify a Dusk typed-data v1 digest.
 *
 * @example
 * ```ts
 * import { hashTypedDataHex } from "@dusk/connect/typed-data";
 * ```
 *
 * @module
 */

export type { FieldDef, HashTypedDataInput, TypedDataErrorCode, HashTypedDataDebug } from "./hash.js";
export {
  TypedDataError,
  hashTypedData,
  hashTypedDataHex,
  hashTypedDataDebug,
  validateTypedDataParams,
  checkPolicyLimits,
} from "./hash.js";
