// Run after building. Check npm's file list and the actual dist-backed exports.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { registerHooks } from "node:module";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
const [pack] = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--ignore-scripts", "--json"], {
  cwd: root, encoding: "utf8",
}));
const files = new Set(pack.files.map(({ path }) => path));
for (const file of readdirSync(new URL("dist/", root), { recursive: true })) {
  if (file.endsWith(".js") || file.endsWith(".d.ts")) {
    assert.ok(files.has(`dist/${file.replaceAll("\\", "/")}`), `Missing packed build file: ${file}`);
  }
}
for (const entry of Object.values(manifest.exports)) {
  for (const target of Object.values(entry)) {
    assert.ok(files.has(target.slice(2)), `Missing packed entrypoint: ${target}`);
  }
}

// Start cold: importing the root must not load the optional cryptography.
const guard = registerHooks({
  resolve(specifier, context, nextResolve) {
    assert.ok(!specifier.startsWith("@dusk/typed-data") && !specifier.startsWith("@noble/"),
      `Root imported cryptography: ${specifier}`);
    return nextResolve(specifier, context);
  },
});
try {
  assert.equal(typeof (await import("@dusk/connect")).createDuskWallet, "function");
} finally {
  guard.deregister();
}

assert.deepEqual({ ...await import("@dusk/connect/typed-data") }, { ...await import("@dusk/typed-data") });
const bls = await import("@dusk/connect/bls");
const sharedBls = await import("@dusk/typed-data/bls");
for (const name of ["BLS_SIGN_DST", "TYPED_DATA_SIG_TAG", "verifyTypedDataSignature", "verifyBlsDigest"]) {
  assert.equal(bls[name], sharedBls[name], `Wrong built BLS export: ${name}`);
}
console.log("PASS: packed entrypoints, crypto-free root and built shared-library exports");
