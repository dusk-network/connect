import { describe, expect, it } from "vitest";
import { bls12_381 } from "@noble/curves/bls12-381";

import { hashTypedData, type HashTypedDataInput } from "../typed-data/hash.js";
import {
  BLS_SIGN_DST,
  TYPED_DATA_SIG_TAG,
  verifyBlsDigest,
  verifyTypedDataSignature,
} from "./sig.js";

/**
 * Deterministic BLS12-381 test key pair. Not derived from any wallet seed -
 * this module's tests generate and own their own keys (per the phase brief,
 * golden vectors under connect/vectors/ are out of scope here).
 */
const TEST_SK = 424242424242424242424242424242n % bls12_381.fields.Fr.ORDER;
const TEST_PK_BYTES = bls12_381.G2.ProjectivePoint.BASE.multiply(TEST_SK).toRawBytes(true);
const TEST_PK_HEX = `0x${bytesToHex(TEST_PK_BYTES)}`;

function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

/** Sign `message` (raw bytes) with the standard Dusk BLS DST, as a wallet would. */
function signRaw(message: Uint8Array, skScalar: bigint): Uint8Array {
  const point = bls12_381.G1.hashToCurve(message, { DST: BLS_SIGN_DST });
  return point.multiply(skScalar).toRawBytes(true);
}

const TYPED_DATA_SIG_TAG_BYTES = new TextEncoder().encode(TYPED_DATA_SIG_TAG);

/** Build `SIG_TAG || digest` (spec 12.1) the same way the signer does. */
function taggedMessage(digest: Uint8Array): Uint8Array {
  const out = new Uint8Array(TYPED_DATA_SIG_TAG_BYTES.length + digest.length);
  out.set(TYPED_DATA_SIG_TAG_BYTES, 0);
  out.set(digest, TYPED_DATA_SIG_TAG_BYTES.length);
  return out;
}

const domain = { name: "Example", version: "1", chainId: "dusk:1" };
const domainTypes = {
  DuskTypedDataDomain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "string" },
    { name: "verifyingContract", type: "bytes32" },
  ],
};

function baseInput(overrides: Partial<HashTypedDataInput> = {}): HashTypedDataInput {
  return {
    domain,
    types: {
      ...domainTypes,
      Greeting: [{ name: "text", type: "string" }],
    },
    primaryType: "Greeting",
    message: { text: "hello" },
    origin: "https://app.example",
    ...overrides,
  };
}

function signTypedDataInput(input: HashTypedDataInput, skScalar: bigint): { signatureHex: string; digest: Uint8Array } {
  const { digest } = hashTypedData(input);
  const signature = signRaw(taggedMessage(digest), skScalar);
  return { signatureHex: `0x${bytesToHex(signature)}`, digest };
}

describe("./bls: TYPED_DATA_SIG_TAG (spec 12.1)", () => {
  it("pins the exact tag bytes and length", () => {
    expect(TYPED_DATA_SIG_TAG).toBe("DUSK_TYPED_DATA_SIG_V1\0");
    expect(TYPED_DATA_SIG_TAG_BYTES).toHaveLength(23);
    expect(Array.from(TYPED_DATA_SIG_TAG_BYTES)).toEqual([
      68, 85, 83, 75, 95, 84, 89, 80, 69, 68, 95, 68, 65, 84, 65, 95, 83, 73, 71, 95, 86, 49, 0,
    ]);
  });

  it("BLS_SIGN_DST matches the unchanged, standard Dusk V2 DST", () => {
    expect(BLS_SIGN_DST).toBe("BLS_SIG_BLS12381G1_XMD:SHA-256_DUSK_V2");
  });
});

describe("./bls: verifyTypedDataSignature", () => {
  it("verifies a known-good tagged signature (round trip)", () => {
    const input = baseInput();
    const { signatureHex } = signTypedDataInput(input, TEST_SK);

    expect(verifyTypedDataSignature(input, signatureHex, TEST_PK_HEX)).toBe(true);
  });

  // The security property this module exists to provide: a raw-digest signing
  // oracle must not be able to forge a typed-data signature.
  it("REJECTS a signature produced over the bare digest, not the tagged message", () => {
    const input = baseInput();
    const { digest } = hashTypedData(input);
    const bareSignature = signRaw(digest, TEST_SK);
    const bareSignatureHex = `0x${bytesToHex(bareSignature)}`;

    // Sanity: the bare-digest signature does verify under the bare-digest verifier.
    expect(verifyBlsDigest(`0x${bytesToHex(digest)}`, bareSignatureHex, TEST_PK_HEX)).toBe(true);

    // But it must not satisfy the typed-data verifier.
    expect(verifyTypedDataSignature(input, bareSignatureHex, TEST_PK_HEX)).toBe(false);
  });

  it("fails when the message value is tampered with", () => {
    const input = baseInput();
    const { signatureHex } = signTypedDataInput(input, TEST_SK);

    const tampered = baseInput({ message: { text: "goodbye" } });
    expect(verifyTypedDataSignature(tampered, signatureHex, TEST_PK_HEX)).toBe(false);
  });

  it("fails when the domain is tampered with", () => {
    const input = baseInput();
    const { signatureHex } = signTypedDataInput(input, TEST_SK);

    const tampered = baseInput({ domain: { ...domain, version: "2" } });
    expect(verifyTypedDataSignature(tampered, signatureHex, TEST_PK_HEX)).toBe(false);
  });

  it("fails when the origin is tampered with", () => {
    const input = baseInput();
    const { signatureHex } = signTypedDataInput(input, TEST_SK);

    const tampered = baseInput({ origin: "https://evil.example" });
    expect(verifyTypedDataSignature(tampered, signatureHex, TEST_PK_HEX)).toBe(false);
  });

  it("fails when the signature is tampered with", () => {
    const input = baseInput();
    const { signatureHex } = signTypedDataInput(input, TEST_SK);

    // Flip a byte deep in the point encoding (not the leading flag bits) so
    // this stays a "wrong signature" case; flipping the flag byte instead
    // would produce a malformed point encoding, which is covered separately
    // below (`verifyTypedDataSignature` returns false either way, never
    // throws, for a correctly-*sized* but bad signature).
    const bytes = Uint8Array.from(Buffer.from(signatureHex.slice(2), "hex"));
    bytes[bytes.length - 1] ^= 0xff;
    const tamperedSignatureHex = `0x${bytesToHex(bytes)}`;

    expect(verifyTypedDataSignature(input, tamperedSignatureHex, TEST_PK_HEX)).toBe(false);
  });

  it("fails (does not throw) when the signature bytes are correctly sized but not a valid point", () => {
    const input = baseInput();
    const { signatureHex } = signTypedDataInput(input, TEST_SK);

    const bytes = Uint8Array.from(Buffer.from(signatureHex.slice(2), "hex"));
    bytes[0] ^= 0xff; // corrupts the compression/sign flag bits
    const invalidPointSignatureHex = `0x${bytesToHex(bytes)}`;

    expect(verifyTypedDataSignature(input, invalidPointSignatureHex, TEST_PK_HEX)).toBe(false);
  });

  it("fails when verified against the wrong public key", () => {
    const input = baseInput();
    const { signatureHex } = signTypedDataInput(input, TEST_SK);

    const otherSk = (TEST_SK + 1n) % bls12_381.fields.Fr.ORDER;
    const otherPkHex = `0x${bytesToHex(
      bls12_381.G2.ProjectivePoint.BASE.multiply(otherSk).toRawBytes(true)
    )}`;

    expect(verifyTypedDataSignature(input, signatureHex, otherPkHex)).toBe(false);
  });

  it("throws on an invalid typed-data payload (spec section 10)", () => {
    const input = baseInput({ primaryType: "DuskTypedDataDomain" });
    expect(() => verifyTypedDataSignature(input, `0x${"00".repeat(48)}`, TEST_PK_HEX)).toThrow();
  });

  it("throws on a malformed signatureHex", () => {
    const input = baseInput();
    expect(() => verifyTypedDataSignature(input, "not-hex", TEST_PK_HEX)).toThrow();
    expect(() => verifyTypedDataSignature(input, `0x${"00".repeat(47)}`, TEST_PK_HEX)).toThrow();
  });

  it("throws on a malformed publicKeyHex", () => {
    const input = baseInput();
    const { signatureHex } = signTypedDataInput(input, TEST_SK);
    expect(() => verifyTypedDataSignature(input, signatureHex, "not-hex")).toThrow();
    expect(() => verifyTypedDataSignature(input, signatureHex, `0x${"00".repeat(95)}`)).toThrow();
  });
});

describe("./bls: verifyBlsDigest (bare digest, NOT the typed-data verifier)", () => {
  it("verifies a signature produced over a bare 32-byte digest", () => {
    const digest = new Uint8Array(32).fill(0x77);
    const signature = signRaw(digest, TEST_SK);
    const digestHex = `0x${bytesToHex(digest)}`;
    const signatureHex = `0x${bytesToHex(signature)}`;

    expect(verifyBlsDigest(digestHex, signatureHex, TEST_PK_HEX)).toBe(true);
  });

  it("rejects when the digest differs", () => {
    const digest = new Uint8Array(32).fill(0x11);
    const other = new Uint8Array(32).fill(0x22);
    const signature = signRaw(digest, TEST_SK);

    expect(
      verifyBlsDigest(`0x${bytesToHex(other)}`, `0x${bytesToHex(signature)}`, TEST_PK_HEX)
    ).toBe(false);
  });

  it("throws on a non-32-byte digestHex", () => {
    const signature = signRaw(new Uint8Array(32), TEST_SK);
    expect(() =>
      verifyBlsDigest(`0x${"00".repeat(31)}`, `0x${bytesToHex(signature)}`, TEST_PK_HEX)
    ).toThrow();
  });
});
