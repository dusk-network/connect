/**
 * Regeneration guard + verification conformance for the BLS vector corpus.
 *
 * Place at: connect/src/bls/vectors.generated.test.ts
 *
 * Mirrors src/typed-data/vectors.generated.test.ts:
 *  - the committed JSON must be byte-identical to what the generator produces,
 *    so derivation or signing cannot change while stale vectors stay committed;
 *  - this repo's verifier must accept every vector. Because the expected bytes
 *    are fixed in the corpus rather than recomputed, this pins the sign side
 *    and the verify side to the same values instead of merely to each other -
 *    which is what a JS-signs/JS-verifies round-trip test cannot do.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { bls12_381 } from "@noble/curves/bls12-381";
import { describe, expect, it } from "vitest";

import { buildBlsVectorFiles } from "../../scripts/generate-bls-vectors.ts";
import type { HashTypedDataInput } from "../typed-data/hash.js";
import { BLS_SIGN_DST, TYPED_DATA_SIG_TAG, verifyTypedDataSignature } from "./sig.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const VECTOR_DIR = path.join(ROOT, "vectors/bls-v1");

interface BlsVector {
  readonly description: string;
  readonly params: {
    readonly dst: string;
    readonly blsVersion: string;
    readonly sigTag: string;
    readonly sigTagHex: string;
  };
  readonly input: {
    readonly seedHex: string;
    readonly profileIndex: number;
    readonly digestHex: string;
    readonly typedDataVector?: string;
    readonly typedData?: HashTypedDataInput;
  };
  readonly expected: {
    readonly secretKeyLeHex: string;
    readonly publicKeyG2Hex: string;
    readonly signedMessageHex: string;
    readonly signatureG1Hex: string;
  };
}

function hexToBytes(hex: string): Uint8Array {
  const body = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

const committedNames = readdirSync(VECTOR_DIR)
  .filter((name) => name.endsWith(".json"))
  .sort();

const vectors: readonly (readonly [string, BlsVector])[] = committedNames.map(
  (name) =>
    [
      name,
      JSON.parse(readFileSync(path.join(VECTOR_DIR, name), "utf8")) as BlsVector,
    ] as const
);

const typedDataVectors = vectors.filter(([, vector]) => vector.input.typedData);

describe("bls vector corpus", () => {
  it("is not empty", () => {
    expect(committedNames.length).toBeGreaterThan(0);
    expect(typedDataVectors.length).toBeGreaterThan(0);
  });

  it("committed JSON is byte-identical to the generator output", () => {
    const generated = buildBlsVectorFiles();

    expect(generated.map((file) => file.fileName).sort()).toEqual(committedNames);

    for (const file of generated) {
      const committed = readFileSync(path.join(VECTOR_DIR, file.fileName), "utf8");
      expect(committed, `${file.fileName} is stale - rerun the generator`).toBe(
        file.contents
      );
    }
  });

  it.each(vectors)("%s pins the Dusk V2 parameters", (_name, vector) => {
    // If these drift the expected bytes below stop meaning anything, so assert
    // both against this repo's constants and against the literal strings.
    expect(vector.params.dst).toBe(BLS_SIGN_DST);
    expect(vector.params.dst).toBe("BLS_SIG_BLS12381G1_XMD:SHA-256_DUSK_V2");
    expect(vector.params.blsVersion).toBe("V2");
    expect(vector.params.sigTag).toBe(TYPED_DATA_SIG_TAG);
  });

  it.each(vectors)("%s has the documented byte lengths", (_name, vector) => {
    expect(hexToBytes(vector.expected.secretKeyLeHex)).toHaveLength(32);
    expect(hexToBytes(vector.expected.publicKeyG2Hex)).toHaveLength(96);
    expect(hexToBytes(vector.expected.signatureG1Hex)).toHaveLength(48);
    // SIG_TAG (23 bytes, trailing NUL included) || digest (32 bytes)
    expect(hexToBytes(vector.expected.signedMessageHex)).toHaveLength(55);
  });

  it.each(vectors)("%s signed message is SIG_TAG || digest", (_name, vector) => {
    const signedMessage = hexToBytes(vector.expected.signedMessageHex);
    const tag = hexToBytes(vector.params.sigTagHex);
    const digest = hexToBytes(vector.input.digestHex);

    expect(signedMessage.slice(0, tag.length)).toEqual(tag);
    expect(signedMessage.slice(tag.length)).toEqual(digest);
  });

  it.each(vectors)(
    "%s signature verifies over the pinned message under the Dusk DST",
    (_name, vector) => {
      const verified = bls12_381.verifyShortSignature(
        hexToBytes(vector.expected.signatureG1Hex),
        bls12_381.G1.hashToCurve(hexToBytes(vector.expected.signedMessageHex), {
          DST: BLS_SIGN_DST,
        }),
        hexToBytes(vector.expected.publicKeyG2Hex)
      );

      expect(verified).toBe(true);
    }
  );

  it.each(vectors)(
    "%s signature does NOT verify under the IETF default DST",
    (_name, vector) => {
      // The corpus's reason for existing: a twin that leaves the library
      // default in place is self-consistent and its round-trip tests pass.
      const verified = bls12_381.verifyShortSignature(
        hexToBytes(vector.expected.signatureG1Hex),
        bls12_381.G1.hashToCurve(hexToBytes(vector.expected.signedMessageHex), {
          DST: "BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_",
        }),
        hexToBytes(vector.expected.publicKeyG2Hex)
      );

      expect(verified).toBe(false);
    }
  );

  it.each(vectors)(
    "%s signature does NOT verify over the bare digest",
    (_name, vector) => {
      const verified = bls12_381.verifyShortSignature(
        hexToBytes(vector.expected.signatureG1Hex),
        bls12_381.G1.hashToCurve(hexToBytes(vector.input.digestHex), {
          DST: BLS_SIGN_DST,
        }),
        hexToBytes(vector.expected.publicKeyG2Hex)
      );

      expect(verified).toBe(false);
    }
  );

  describe("through the public verifier", () => {
    it.each(typedDataVectors)(
      "%s verifies via verifyTypedDataSignature",
      (_name, vector) => {
        const verified = verifyTypedDataSignature(
          vector.input.typedData!,
          vector.expected.signatureG1Hex,
          vector.expected.publicKeyG2Hex
        );

        expect(verified).toBe(true);
      }
    );

    it.each(typedDataVectors)(
      "%s is rejected when the payload is altered",
      (_name, vector) => {
        const tampered = structuredClone(vector.input.typedData!) as {
          domain: { name?: string };
        };
        tampered.domain.name = `${tampered.domain.name ?? ""} (tampered)`;

        const verified = verifyTypedDataSignature(
          tampered as HashTypedDataInput,
          vector.expected.signatureG1Hex,
          vector.expected.publicKeyG2Hex
        );

        expect(verified).toBe(false);
      }
    );
  });
});
