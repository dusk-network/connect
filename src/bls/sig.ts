/**
 * BLS12-381 short-signature verification for Dusk typed-data v1 (opt-in).
 *
 * Normative spec: docs/typed-data-v1.md, section 12.
 *
 * The typed-data digest (spec section 9) is 32 bytes, and therefore
 * indistinguishable from any other 32-byte value the same Moonlight BLS key
 * might be asked to sign under the same DST - including pay-auth digests used
 * by other products. The signature is computed over a tagged wrapper, not the
 * bare digest, so that message space is structurally disjoint from every
 * other 32-byte message space the key signs (spec 12.1).
 *
 * @module
 */
import { bls12_381 } from "@noble/curves/bls12-381";

import { hexToBytes } from "../bytes.js";
import { hashTypedData, type HashTypedDataInput } from "../typed-data/hash.js";

/**
 * Standard Dusk BLS12-381 short-signature domain separation tag
 * (`BlsVersion::V2`), unchanged by typed-data. A custom DST would give the
 * same message-space separation but break verification through the stock
 * dusk-core path, which pins this DST and accepts no caller-supplied
 * override - on-chain verifiability is a goal of the scheme.
 */
export const BLS_SIGN_DST = "BLS_SIG_BLS12381G1_XMD:SHA-256_DUSK_V2";

/**
 * Typed-data signature domain tag (spec 12.1):
 *
 *   SIG_TAG = utf8("DUSK_TYPED_DATA_SIG_V1\0")   // 23 bytes, trailing NUL included
 *
 * The signature covers `SIG_TAG || digest` (55 bytes total), never the bare
 * 32-byte digest. See `verifyBlsDigest` below for why that distinction is the
 * whole point of this module.
 */
export const TYPED_DATA_SIG_TAG = "DUSK_TYPED_DATA_SIG_V1\0";

const TYPED_DATA_SIG_TAG_BYTES = new TextEncoder().encode(TYPED_DATA_SIG_TAG);

/** `SIG_TAG || digest` (spec 12.1). Throws unless `digest` is exactly 32 bytes. */
function buildTypedDataSignedMessage(digest: Uint8Array): Uint8Array {
  if (digest.length !== 32) {
    throw new Error(`digest must be exactly 32 bytes, got ${digest.length}`);
  }
  const out = new Uint8Array(TYPED_DATA_SIG_TAG_BYTES.length + digest.length);
  out.set(TYPED_DATA_SIG_TAG_BYTES, 0);
  out.set(digest, TYPED_DATA_SIG_TAG_BYTES.length);
  return out;
}

/** Decode `0x`-hex to bytes, requiring an exact byte length. Throws otherwise. */
function decodeFixedHex(hex: string, expectedLength: number, label: string): Uint8Array {
  if (typeof hex !== "string") {
    throw new Error(`${label} must be a hex string`);
  }
  const bytes = hexToBytes(hex);
  if (bytes.length !== expectedLength) {
    throw new Error(`${label} must decode to exactly ${expectedLength} bytes, got ${bytes.length}`);
  }
  return bytes;
}

/**
 * Run the underlying curve library's signature check, normalizing "well-formed
 * length, but not a valid curve point encoding" to `false` rather than letting
 * it throw. Correctly-shaped-but-garbage bytes are exactly what an attacker
 * controls (a tampered or fabricated signature/public key), so a verifier must
 * be able to treat that as "does not verify" without a try/catch of its own.
 */
function safeVerifyShortSignature(
  signatureBytes: Uint8Array,
  message: Uint8Array,
  publicKeyBytes: Uint8Array
): boolean {
  try {
    return bls12_381.verifyShortSignature(signatureBytes, message, publicKeyBytes, {
      DST: BLS_SIGN_DST,
    });
  } catch {
    return false;
  }
}

/**
 * Verify a Dusk typed-data v1 signature (spec 12.3).
 *
 * Recomputes the digest from `input` using the typed-data hashing
 * implementation (`../typed-data/hash.js`), builds `SIG_TAG || digest`
 * (spec 12.1), and verifies the BLS short signature over that tagged message
 * under the standard DST.
 *
 * Error convention: throws on malformed *input shape* - an invalid typed-data
 * payload (rejected per spec section 10, surfaced as `TypedDataError`), or a
 * `signatureHex` / `publicKeyHex` that is not well-formed hex of the expected
 * length. Returns `false` (not a throw) for anything that is shaped correctly
 * but does not verify: a signature that fails cryptographic verification, a
 * correctly-sized but invalid curve point encoding (attacker-controlled
 * garbage bytes), or - the security property this module exists to provide -
 * a signature that was produced over the bare digest instead of the tagged
 * message. A caller checking an untrusted signature never needs its own
 * try/catch around the "does this verify" question, only around the "is this
 * even shaped like typed-data / hex" question.
 *
 * @param input typed-data payload, spec section 3 (same shape `hashTypedData` accepts)
 * @param signatureHex `0x`-hex, 48-byte compressed G1 signature
 * @param publicKeyHex `0x`-hex, 96-byte compressed G2 public key
 */
export function verifyTypedDataSignature(
  input: HashTypedDataInput,
  signatureHex: string,
  publicKeyHex: string
): boolean {
  const { digest } = hashTypedData(input);
  const signedMessage = buildTypedDataSignedMessage(digest);
  const signatureBytes = decodeFixedHex(signatureHex, 48, "signatureHex");
  const publicKeyBytes = decodeFixedHex(publicKeyHex, 96, "publicKeyHex");

  return safeVerifyShortSignature(signatureBytes, signedMessage, publicKeyBytes);
}

/**
 * Verify a signature over a BARE 32-byte digest.
 *
 * This is NOT the typed-data verifier, and it MUST NOT be used to check
 * typed-data signatures. A bare 32-byte digest is indistinguishable from any
 * other 32-byte value the same key might sign under the same DST (e.g.
 * Moonlight pay-auth digests); verifying typed-data signatures this way
 * would accept a signature produced by any unrelated raw-digest signing
 * path. Use `verifyTypedDataSignature` for typed-data.
 *
 * Error convention: same as `verifyTypedDataSignature` - throws on malformed
 * hex or wrong length, returns `false` (never throws) for anything correctly
 * sized that simply does not verify, including an invalid point encoding.
 *
 * @param digestHex `0x`-hex, 32-byte bare digest
 * @param signatureHex `0x`-hex, 48-byte compressed G1 signature
 * @param publicKeyHex `0x`-hex, 96-byte compressed G2 public key
 */
export function verifyBlsDigest(digestHex: string, signatureHex: string, publicKeyHex: string): boolean {
  const digestBytes = decodeFixedHex(digestHex, 32, "digestHex");
  const signatureBytes = decodeFixedHex(signatureHex, 48, "signatureHex");
  const publicKeyBytes = decodeFixedHex(publicKeyHex, 96, "publicKeyHex");

  return safeVerifyShortSignature(signatureBytes, digestBytes, publicKeyBytes);
}
