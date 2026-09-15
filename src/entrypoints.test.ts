import { readFileSync } from "node:fs";
import { findPackageJSON } from "node:module";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
import { hashTypedDataHex } from "./typed-data/index.js";
import { verifyTypedDataSignature } from "./bls/index.js";
import * as typedData from "./typed-data/index.js";
import * as bls from "./bls/index.js";
import * as shared from "@dusk/typed-data";
import * as sharedBls from "@dusk/typed-data/bls";

const npm = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const jsr = JSON.parse(readFileSync(new URL("../jsr.json", import.meta.url), "utf8"));

it.each([
  ["typed-data", hashTypedDataHex],
  ["bls", verifyTypedDataSignature],
])("exports ./%s through both package manifests", (name, entrypoint) => {
  expect(npm.exports[`./${name}`]).toEqual({
    types: `./dist/${name}/index.d.ts`,
    import: `./dist/${name}/index.js`,
  });
  expect(jsr.exports[`./${name}`]).toBe(`./src/${name}/index.ts`);
  expect(entrypoint).toBeTypeOf("function");
});

it("pins the same shared protocol version for npm and JSR", () => {
  const version = jsr.imports["@dusk/typed-data"].replace("jsr:@dusk/typed-data@", "");
  expect(npm.dependencies["@dusk/typed-data"]).toBe(`npm:@jsr/dusk__typed-data@${version}`);
  const installed = JSON.parse(readFileSync(findPackageJSON("@dusk/typed-data", import.meta.url)!, "utf8"));
  expect(installed.name).toBe("@jsr/dusk__typed-data");
  expect(installed.version).toBe(version);
});

it("exposes shared-package re-exports through the Connect subpaths", () => {
  expect(typedData).toEqual(shared);
  expect(typedData).not.toHaveProperty("checkPolicyLimits");
  expect({ ...bls }).toEqual({
    BLS_SIGN_DST: sharedBls.BLS_SIGN_DST,
    TYPED_DATA_SIG_TAG: sharedBls.TYPED_DATA_SIG_TAG,
    verifyTypedDataSignature: sharedBls.verifyTypedDataSignature,
    verifyBlsDigest: sharedBls.verifyBlsDigest,
  });
});

it("verifies a packaged frozen signature with the required policy and structured result", () => {
  // ponytail: JSR does not export fixtures; use public subpaths if it adds them.
  const packageRoot = dirname(findPackageJSON("@dusk/typed-data", import.meta.url)!);
  const vector = JSON.parse(readFileSync(join(packageRoot,
    "vectors/bls-signing/typed_data_digest_nested_struct.json"
  ), "utf8"));
  const input = vector.input.typedData;
  const { signatureG1Hex, publicKeyG2Hex } = vector.expected;
  const policy = { chainId: "dusk:1", origin: "https://app.example" };
  expect(verifyTypedDataSignature(input, signatureG1Hex, publicKeyG2Hex, policy)).toEqual({
    ...policy, digestHex: vector.input.digestHex, ok: true, code: "OK",
  });
  expect(verifyTypedDataSignature(input, signatureG1Hex, publicKeyG2Hex, {
    ...policy, chainId: "dusk:2",
  }).code).toBe("E_CHAIN_MISMATCH");
  expect(verifyTypedDataSignature(input, signatureG1Hex, publicKeyG2Hex, {
    ...policy, origin: "https://other.example",
  }).code).toBe("E_ORIGIN_MISMATCH");
});
