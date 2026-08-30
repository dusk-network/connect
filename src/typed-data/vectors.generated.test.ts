import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  buildAcceptVectorFiles,
  buildRejectVectorFiles,
  checkRejectCoverage,
} from "../../scripts/generate-typed-data-vectors.ts";

/**
 * Regeneration guard for the typed-data-v1 golden vector corpus.
 *
 * vectors/typed-data-v1/**.json are the interoperability contract with the
 * wallet twin (wallet/src/shared/typedDataHash.js), which vendors them
 * verbatim (see wallet/src/shared/fixtures/typed-data-v1/SOURCE). This test
 * regenerates the corpus in memory, from this repo's own reference
 * implementation, using the exact same pure functions
 * scripts/generate-typed-data-vectors.ts uses to write the files on disk -
 * and asserts the committed JSON is byte-identical to what generation would
 * produce right now.
 *
 * This is what stops a hash-affecting change to src/typed-data/hash.ts (or
 * to the generator's declarative vector list) from landing with stale
 * committed vectors: this test fails long before anyone notices the wallet
 * and Connect have quietly diverged.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ACCEPT_DIR = path.join(ROOT, "vectors/typed-data-v1");
const REJECT_DIR = path.join(ACCEPT_DIR, "reject");

function committedFileNames(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".json"))
    .map((e) => e.name)
    .sort();
}

describe("typed-data-v1 vector corpus regeneration", () => {
  it("covers every §10 error code", () => {
    expect(() => checkRejectCoverage()).not.toThrow();
  });

  it("committed accept vectors are byte-identical to a fresh regeneration", () => {
    const generated = buildAcceptVectorFiles();
    const committedNames = committedFileNames(ACCEPT_DIR);
    const generatedNames = Object.keys(generated).sort();

    expect(committedNames, "committed accept vector file list differs from generator output").toEqual(
      generatedNames
    );

    for (const name of generatedNames) {
      const committed = readFileSync(path.join(ACCEPT_DIR, name), "utf8");
      expect(committed, `vectors/typed-data-v1/${name} is stale - run npm run generate:typed-data-vectors`).toBe(
        generated[name]
      );
    }
  });

  it("every accept vector's signedMessageHex is well-formed and tied to its own digestHex", () => {
    const names = committedFileNames(ACCEPT_DIR);
    expect(names.length).toBeGreaterThan(0);

    for (const name of names) {
      const vector = JSON.parse(readFileSync(path.join(ACCEPT_DIR, name), "utf8")) as {
        digestHex: string;
        signedMessageHex: string;
      };

      // "0x" + 110 lowercase hex chars: SIG_TAG (23 bytes) || digest (32 bytes) = 55 bytes.
      expect(vector.signedMessageHex, `${name}: signedMessageHex must be "0x" + 110 lowercase hex chars`).toMatch(
        /^0x[0-9a-f]{110}$/
      );

      // Ties the signed message to the digest itself, not just to its shape -
      // a signedMessageHex that is well-formed but derived from a different
      // digest would otherwise pass the regex check above undetected.
      expect(
        vector.signedMessageHex.endsWith(vector.digestHex.slice(2)),
        `${name}: signedMessageHex must end with this vector's own digestHex`
      ).toBe(true);
    }
  });

  it("committed reject vectors are byte-identical to a fresh regeneration", () => {
    const generated = buildRejectVectorFiles();
    const committedNames = committedFileNames(REJECT_DIR);
    const generatedNames = Object.keys(generated).sort();

    expect(committedNames, "committed reject vector file list differs from generator output").toEqual(
      generatedNames
    );

    for (const name of generatedNames) {
      const committed = readFileSync(path.join(REJECT_DIR, name), "utf8");
      expect(
        committed,
        `vectors/typed-data-v1/reject/${name} is stale - run npm run generate:typed-data-vectors`
      ).toBe(generated[name]);
    }
  });
});
