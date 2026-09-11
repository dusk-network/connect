/**
 * Generator for the Dusk BLS cross-implementation vector corpus (v1).
 *
 * Companion to `generate-typed-data-vectors.ts`. That corpus pins the *digest*;
 * this one pins everything downstream of it: key derivation, the tagged signed
 * message, and the signature itself.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every existing BLS test in both repos is JS-signs / JS-verifies. A round-trip
 * is structurally blind to a wrong domain-separation tag or a wrong group
 * assignment: sign and verify with the same wrong parameter and the test still
 * passes, while the Rust verifier rejects every signature the wallet emits.
 * These vectors are the only artifact that can catch that, because their
 * expected bytes are fixed independently of the code under test.
 *
 * ENCODINGS ARE NORMATIVE, NOT INHERITED
 * --------------------------------------
 * Every byte string below is serialized explicitly, by this file, in the byte
 * order the Rust implementation uses. In particular `secretKeyLeHex` is written
 * by `scalarToLeBytes` and NOT by `bls12_381.fields.Fr.toBytes`, whose byte
 * order is a library convention rather than a protocol fact - it is
 * little-endian in @noble/curves 1.x and big-endian in 2.x. A vector that
 * inherits its encoding from a dependency stops meaning what it claims the
 * moment that dependency is upgraded, and the failing assertion invites exactly
 * the wrong fix (regenerate the constant), which silently replaces a
 * Rust-derived value with whatever the new library emits.
 *
 * SOURCE OF TRUTH
 * ---------------
 * The authority for these values is the Rust implementation:
 *   - key derivation ... rusk `wallet-core/src/keys/mod.rs`
 *                        (`derive_bls_sk`, `rng_with_index`)
 *   - hash-to-curve .... `bls12_381-bls` 0.6.0 `src/hash.rs` (`h0`, `H0_DST`)
 *   - signature scheme . `dusk_core::signatures::bls`, `BlsVersion::V2`
 *
 * The `ANCHOR_*` constants below are values produced by that Rust code. The
 * generator refuses to emit anything if it cannot reproduce them, so a JS-side
 * regression cannot quietly rewrite the corpus to match itself.
 *
 * Every vector in this corpus has been confirmed byte-identical against that
 * Rust implementation - secret key, public key, signed message and signature -
 * using the emitter in `tools/rust-vector-emitter/`, built against
 * `bls12_381-bls` 0.6.0 (the version rusk's workspace pins) with derivation
 * transcribed from `wallet-core`. Re-run it when the corpus changes; it is the
 * only thing that makes these vectors cross-language rather than JS agreeing
 * with itself around a single anchor point.
 *
 * Usage:
 *   node scripts/generate-bls-vectors.ts
 *
 * `buildBlsVectorFiles` is also imported in-memory by the regeneration guard
 * test, which asserts the committed JSON is byte-identical to what this script
 * would produce.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { bls12_381 } from "@noble/curves/bls12-381";
import { sha256 } from "@noble/hashes/sha2";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "vectors/bls-v1");
const TYPED_DATA_DIR = path.join(ROOT, "vectors/typed-data-v1");

/**
 * Dusk V2 hash-to-curve domain separation tag.
 *
 * `bls12_381-bls` 0.6.0 src/hash.rs:
 *   const H0_DST: &[u8] = b"BLS_SIG_BLS12381G1_XMD:SHA-256_DUSK_V2";
 *
 * This is deliberately NOT the IETF ciphersuite
 * (`..._SSWU_RO_NUL_`) that every BLS library uses as its default. Signing or
 * verifying under the default produces a self-consistent scheme that the chain
 * rejects, which is the single most likely way for a JS twin to be wrong.
 */
const BLS_SIGN_DST = "BLS_SIG_BLS12381G1_XMD:SHA-256_DUSK_V2";

/** Typed-data signature domain tag (typed-data-v1 spec section 12.1). 23 bytes, trailing NUL included. */
const TYPED_DATA_SIG_TAG = "DUSK_TYPED_DATA_SIG_V1\0";

/** RNG termination string for BLS keys - rusk `derive_bls_sk` passes b"SK". */
const RNG_TERMINATION_SK = "SK";

/**
 * Anchors: produced by the Rust implementation, not by this file.
 *
 * seed = [0u8; 64], index = 42:
 *   derive_bls_sk(&seed, 42).to_bytes()   // BlsScalar::to_bytes, little-endian
 */
const ANCHOR_SEED_HEX = "00".repeat(64);
const ANCHOR_INDEX = 42;
const ANCHOR_SK_LE_HEX =
  "5f23a7bf6aab479e9f27540184ee98eb9a05fa9effc34f5fc13a24bd0063e656";

// ---------------------------------------------------------------------------
// Byte helpers - explicit, so no encoding is inherited from a dependency.
// ---------------------------------------------------------------------------

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return `0x${out}`;
}

function hexToBytes(hex: string): Uint8Array {
  const body = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (body.length % 2 !== 0) throw new Error(`odd-length hex: ${hex}`);
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Serialize a scalar as 32 little-endian bytes.
 *
 * Matches Rust `dusk_bls12_381::BlsScalar::to_bytes` / `Serializable<32>`.
 * Written out by hand on purpose - see the ENCODINGS note in the file header.
 */
function scalarToLeBytes(scalar: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let rest = scalar;
  for (let i = 0; i < 32; i++) {
    out[i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  if (rest !== 0n) throw new Error("scalar does not fit in 32 bytes");
  return out;
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Derivation and signing, transcribed from the Rust.
// ---------------------------------------------------------------------------

const Fr_ORDER = bls12_381.fields.Fr.ORDER;

/**
 * One ChaCha12 block with a zero nonce and zero counter.
 *
 * `ChaCha12Rng::from_seed(seed)` starts at stream 0, counter 0, so the first 64
 * bytes drawn from it are exactly block 0.
 */
function chacha12Block(key32: Uint8Array): Uint8Array {
  const CONSTANTS = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574];
  const init = new Uint32Array(16);
  const keyView = new DataView(key32.buffer, key32.byteOffset, 32);

  init[0] = CONSTANTS[0]!;
  init[1] = CONSTANTS[1]!;
  init[2] = CONSTANTS[2]!;
  init[3] = CONSTANTS[3]!;
  for (let i = 0; i < 8; i++) init[4 + i] = keyView.getUint32(i * 4, true);
  // init[12..16] stay zero: 64-bit counter and 64-bit stream id, both 0.

  const state = new Uint32Array(init);
  const rotl32 = (n: number, b: number) => ((n << b) | (n >>> (32 - b))) >>> 0;

  function quarterRound(a: number, b: number, c: number, d: number): void {
    state[a] = (state[a]! + state[b]!) >>> 0;
    state[d] = rotl32(state[d]! ^ state[a]!, 16);
    state[c] = (state[c]! + state[d]!) >>> 0;
    state[b] = rotl32(state[b]! ^ state[c]!, 12);
    state[a] = (state[a]! + state[b]!) >>> 0;
    state[d] = rotl32(state[d]! ^ state[a]!, 8);
    state[c] = (state[c]! + state[d]!) >>> 0;
    state[b] = rotl32(state[b]! ^ state[c]!, 7);
  }

  for (let round = 0; round < 6; round++) {
    quarterRound(0, 4, 8, 12);
    quarterRound(1, 5, 9, 13);
    quarterRound(2, 6, 10, 14);
    quarterRound(3, 7, 11, 15);
    quarterRound(0, 5, 10, 15);
    quarterRound(1, 6, 11, 12);
    quarterRound(2, 7, 8, 13);
    quarterRound(3, 4, 9, 14);
  }

  for (let i = 0; i < 16; i++) state[i] = (state[i]! + init[i]!) >>> 0;

  const out = new Uint8Array(64);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 16; i++) outView.setUint32(i * 4, state[i]!, true);
  return out;
}

/** `BlsScalar::from_bytes_wide`: 64 bytes as a little-endian 512-bit integer, reduced mod r. */
function fromBytesWide(bytes64: Uint8Array): bigint {
  let result = 0n;
  for (let i = 63; i >= 0; i--) result = (result << 8n) | BigInt(bytes64[i]!);
  return result % Fr_ORDER;
}

/**
 * rusk `wallet-core`:
 *   rng_with_index(seed, index, b"SK") = ChaCha12Rng::from_seed(
 *     Sha256(seed || (index as u64).to_le_bytes() || b"SK"))
 *   derive_bls_sk = BlsSecretKey::random(&mut rng) = BlsScalar::random(rng)
 */
function deriveBlsSecretKey(seed: Uint8Array, profileIndex: number): bigint {
  const indexBytes = new Uint8Array(8);
  new DataView(indexBytes.buffer).setBigUint64(0, BigInt(profileIndex), true);
  const seed32 = sha256(
    concatBytes(seed, indexBytes, utf8(RNG_TERMINATION_SK))
  );
  return fromBytesWide(chacha12Block(seed32));
}

/** Compressed G2 public key (96 bytes) - Dusk is the min-sig variant. */
function publicKeyG2(skScalar: bigint): Uint8Array {
  return bls12_381.G2.ProjectivePoint.BASE.multiply(skScalar).toRawBytes(true);
}

/** Compressed G1 signature (48 bytes) over raw message bytes, under the Dusk V2 DST. */
function signMessage(message: Uint8Array, skScalar: bigint): Uint8Array {
  return bls12_381.G1.hashToCurve(message, { DST: BLS_SIGN_DST })
    .multiply(skScalar)
    .toRawBytes(true);
}

/** SIG_TAG || digest - 55 bytes. Never the bare digest. */
function taggedMessage(digest: Uint8Array): Uint8Array {
  if (digest.length !== 32) {
    throw new Error(`digest must be 32 bytes, got ${digest.length}`);
  }
  return concatBytes(utf8(TYPED_DATA_SIG_TAG), digest);
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

interface VectorCase {
  readonly name: string;
  readonly description: string;
  readonly seedHex: string;
  readonly profileIndex: number;
  /** 32-byte digest to sign. Ignored when `typedDataVector` is set. */
  readonly digestHex?: string;
  /**
   * File name under `vectors/typed-data-v1/`. When set, the digest AND the
   * originating typed-data payload are read from that vector and embedded, so
   * the case can be replayed through the real `verifyTypedDataSignature` entry
   * point rather than a lower-level digest verifier. This is what ties the two
   * corpora together: if the typed-data hash changes, this vector's digest
   * changes with it and the regeneration guard fails.
   */
  readonly typedDataVector?: string;
}

interface TypedDataVectorFile {
  readonly input: unknown;
  readonly digestHex: string;
}

function readTypedDataVector(fileName: string): TypedDataVectorFile {
  const raw = readFileSync(path.join(TYPED_DATA_DIR, fileName), "utf8");
  const parsed = JSON.parse(raw) as Partial<TypedDataVectorFile>;
  if (!parsed.input || typeof parsed.digestHex !== "string") {
    throw new Error(
      `typed-data vector ${fileName} has no input/digestHex - is it a reject vector?`
    );
  }
  return { input: parsed.input, digestHex: parsed.digestHex };
}

const CASES: readonly VectorCase[] = [
  {
    name: "anchor_zero_seed_index_42",
    description:
      "Rust anchor: zero seed, profile index 42. secretKeyLeHex is a value produced by rusk derive_bls_sk, not by this generator.",
    seedHex: ANCHOR_SEED_HEX,
    profileIndex: ANCHOR_INDEX,
    digestHex: `0x${"00".repeat(32)}`,
  },
  {
    name: "zero_seed_index_0",
    description: "Zero seed, profile index 0 - the lowest index a wallet uses.",
    seedHex: ANCHOR_SEED_HEX,
    profileIndex: 0,
    digestHex: `0x${"11".repeat(32)}`,
  },
  {
    name: "zero_seed_index_255",
    description:
      "Zero seed, profile index 255 - the highest value of the u8 index rusk casts to u64.",
    seedHex: ANCHOR_SEED_HEX,
    profileIndex: 255,
    digestHex: `0x${"ff".repeat(32)}`,
  },
  {
    name: "patterned_seed_index_1",
    description:
      "Non-zero seed (0x00..0x3f) so a seed handled as all-zero, truncated, or byte-reversed produces a different key.",
    seedHex: Array.from({ length: 64 }, (_, i) =>
      i.toString(16).padStart(2, "0")
    ).join(""),
    profileIndex: 1,
    digestHex: `0x${"a5".repeat(32)}`,
  },
  {
    name: "typed_data_digest_nested_struct",
    description:
      "Signs the digest from the typed-data corpus vector `nested_struct`, tying the two corpora together end to end. Carries the originating payload so it can be replayed through verifyTypedDataSignature.",
    seedHex: ANCHOR_SEED_HEX,
    profileIndex: 0,
    typedDataVector: "nested_struct.json",
  },
];

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export interface BlsVectorFile {
  readonly fileName: string;
  readonly contents: string;
}

function buildVector(testCase: VectorCase): BlsVectorFile {
  const seed = hexToBytes(testCase.seedHex);

  const typedData = testCase.typedDataVector
    ? readTypedDataVector(testCase.typedDataVector)
    : undefined;
  const digestHex = typedData?.digestHex ?? testCase.digestHex;
  if (!digestHex) {
    throw new Error(`case ${testCase.name} has neither digestHex nor typedDataVector`);
  }
  const digest = hexToBytes(digestHex);

  const skScalar = deriveBlsSecretKey(seed, testCase.profileIndex);
  const skLeBytes = scalarToLeBytes(skScalar);
  const pkBytes = publicKeyG2(skScalar);
  const signedMessage = taggedMessage(digest);
  const signature = signMessage(signedMessage, skScalar);

  // A vector that does not verify under its own parameters is a generator bug.
  const verified = bls12_381.verifyShortSignature(
    signature,
    bls12_381.G1.hashToCurve(signedMessage, { DST: BLS_SIGN_DST }),
    pkBytes
  );
  if (!verified) {
    throw new Error(`vector ${testCase.name} does not verify under its own key`);
  }

  const vector = {
    description: testCase.description,
    encoding: {
      seed: "64 bytes, BIP39 seed",
      secretKey:
        "32 bytes, little-endian - Rust dusk_bls12_381 BlsScalar::to_bytes. NOT @noble/curves Fr.toBytes, whose order differs across major versions.",
      publicKey: "96 bytes, compressed G2 (Dusk uses the min-sig variant)",
      signature: "48 bytes, compressed G1",
      signedMessage: "SIG_TAG || digest, 55 bytes",
    },
    params: {
      dst: BLS_SIGN_DST,
      blsVersion: "V2",
      sigTag: TYPED_DATA_SIG_TAG,
      sigTagHex: bytesToHex(utf8(TYPED_DATA_SIG_TAG)),
      rngTermination: RNG_TERMINATION_SK,
    },
    input: {
      seedHex: `0x${testCase.seedHex}`,
      profileIndex: testCase.profileIndex,
      digestHex,
      ...(typedData
        ? {
            typedDataVector: testCase.typedDataVector,
            typedData: typedData.input,
          }
        : {}),
    },
    expected: {
      secretKeyLeHex: bytesToHex(skLeBytes),
      publicKeyG2Hex: bytesToHex(pkBytes),
      signedMessageHex: bytesToHex(signedMessage),
      signatureG1Hex: bytesToHex(signature),
    },
  };

  return {
    fileName: `${testCase.name}.json`,
    contents: `${JSON.stringify(vector, null, 2)}\n`,
  };
}

/**
 * Refuse to emit a corpus that cannot reproduce the Rust-produced anchor.
 *
 * Without this, a regression in derivation would simply rewrite every expected
 * value to match the broken implementation and CI would stay green.
 */
function assertAnchor(): void {
  const skScalar = deriveBlsSecretKey(
    hexToBytes(ANCHOR_SEED_HEX),
    ANCHOR_INDEX
  );
  const actual = bytesToHex(scalarToLeBytes(skScalar));
  const expected = `0x${ANCHOR_SK_LE_HEX}`;
  if (actual !== expected) {
    throw new Error(
      `derivation does not reproduce the rusk anchor.\n` +
        `  expected (rusk derive_bls_sk): ${expected}\n` +
        `  actual   (this generator):     ${actual}\n` +
        `Fix the derivation - do NOT update the anchor.`
    );
  }
}

export function buildBlsVectorFiles(): readonly BlsVectorFile[] {
  assertAnchor();
  return CASES.map(buildVector);
}

function main(): void {
  const files = buildBlsVectorFiles();

  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  for (const file of files) {
    writeFileSync(path.join(OUT_DIR, file.fileName), file.contents, "utf8");
  }

  const written = readdirSync(OUT_DIR).sort();
  console.log(`wrote ${written.length} vectors to ${path.relative(ROOT, OUT_DIR)}`);
  for (const name of written) console.log(`  ${name}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
