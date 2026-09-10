import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { hashTypedDataHex } from "./typed-data/index.js";
import { verifyTypedDataSignature } from "./bls/index.js";

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

it.each(["@noble/curves", "@noble/hashes"])("resolves %s through JSR", name => {
  expect(jsr.imports[name]).toBe(`npm:${name}@${npm.dependencies[name]}`);
});
