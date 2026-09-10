import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  checkPolicyLimits,
  hashTypedData,
  hashTypedDataDebug,
  hashTypedDataHex,
  validateTypedDataParams,
  type TypedDataErrorCode,
  TypedDataError,
} from "./hash.js";

const VECTOR_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "vectors",
  "typed-data-v1"
);

function loadVector(name: string): any {
  return JSON.parse(readFileSync(path.join(VECTOR_DIR, name), "utf8"));
}

/** Assert `fn` throws a `TypedDataError` with the given stable spec-10 error code. */
function expectCode(fn: () => unknown, code: TypedDataErrorCode): void {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(TypedDataError);
  expect((caught as TypedDataError).code).toBe(code);
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
const origin = "https://app.example";

describe("typed-data hash v1", () => {
  it.each(readdirSync(VECTOR_DIR).filter(name => name.endsWith(".json")))(
    "matches golden digest for %s",
    (name) => {
      const vector = loadVector(name);
      expect(hashTypedDataHex(vector.input)).toBe(vector.digestHex);
    }
  );

  it.each(readdirSync(path.join(VECTOR_DIR, "reject")).filter(name => name.endsWith(".json")))(
    "rejects frozen vector %s",
    name => {
      const vector = loadVector(`reject/${name}`);
      expectCode(() => hashTypedData(vector.input), vector.error);
    }
  );

  it("rejects missing primaryType with E_PRIMARY_MISSING", () => {
    const vector = loadVector("sign_in_basic.json");
    expectCode(
      () => validateTypedDataParams({ ...vector.input, primaryType: undefined }),
      "E_PRIMARY_MISSING"
    );
  });

  it("rejects a types map missing DuskTypedDataDomain with E_DOMAIN_TYPE", () => {
    const vector = loadVector("sign_in_basic.json");
    const types = { ...vector.input.types };
    delete types.DuskTypedDataDomain;
    expectCode(
      () => validateTypedDataParams({ ...vector.input, types }),
      "E_DOMAIN_TYPE"
    );
  });
});

describe("string/bytes encoding (spec 5.1)", () => {
  it("does not apply any value-dependent size budget (spec 11 removes it from validity)", () => {
    const big = "x".repeat(2_000_000);
    expect(() =>
      hashTypedDataHex({
        domain,
        types: { ...domainTypes, Big: [{ name: "blob", type: "string" }] },
        primaryType: "Big",
        message: { blob: big },
        origin,
      })
    ).not.toThrow();
  });
});

describe("uint64 JSON", () => {
  it("rejects unsafe JSON number for uint64 with E_UINT_RANGE", () => {
    expectCode(
      () =>
        hashTypedDataHex({
          domain,
          types: { ...domainTypes, U: [{ name: "n", type: "uint64" }] },
          primaryType: "U",
          message: { n: 9007199254740993 },
          origin,
        }),
      "E_UINT_RANGE"
    );
  });

  it("rejects decimal string overflow for uint64 with E_UINT_RANGE", () => {
    expectCode(
      () =>
        hashTypedDataHex({
          domain,
          types: { ...domainTypes, U: [{ name: "n", type: "uint64" }] },
          primaryType: "U",
          message: { n: "18446744073709551616" },
          origin,
        }),
      "E_UINT_RANGE"
    );
  });
});

describe("validation error codes (spec section 10)", () => {
  it("E_PRIMARY_INVALID: primaryType is DuskTypedDataDomain", () => {
    expectCode(
      () =>
        hashTypedData({
          domain,
          types: { ...domainTypes, S: [{ name: "text", type: "string" }] },
          primaryType: "DuskTypedDataDomain",
          message: domain,
          origin,
        }),
      "E_PRIMARY_INVALID"
    );
  });

  it("E_TYPE_INVALID: array size has a leading zero (T[01])", () => {
    expectCode(
      () =>
        hashTypedData({
          domain,
          types: { ...domainTypes, S: [{ name: "items", type: "uint8[01]" }] },
          primaryType: "S",
          message: { items: [1] },
          origin,
        }),
      "E_TYPE_INVALID"
    );
  });

  it("E_TYPE_INVALID: zero-length array (T[0])", () => {
    expectCode(
      () =>
        hashTypedData({
          domain,
          types: { ...domainTypes, S: [{ name: "items", type: "uint8[0]" }] },
          primaryType: "S",
          message: { items: [] },
          origin,
        }),
      "E_TYPE_INVALID"
    );
  });

  it("E_TYPE_CYCLE: mutually recursive struct types", () => {
    expectCode(
      () =>
        hashTypedData({
          domain,
          types: {
            ...domainTypes,
            A: [{ name: "b", type: "B" }],
            B: [{ name: "a", type: "A" }],
          },
          primaryType: "A",
          message: { b: { a: {} } },
          origin,
        }),
      "E_TYPE_CYCLE"
    );
  });

  it("E_FIELD_MISSING: field is present only via the prototype chain, not as an own property", () => {
    const vector = loadVector("sign_in_basic.json");
    const message = Object.assign(Object.create({ address: "via-prototype" }), {
      statement: "Sign in to Example",
    });
    expectCode(() => hashTypedData({ ...vector.input, message }), "E_FIELD_MISSING");
  });
});

describe("checkPolicyLimits (spec section 11)", () => {
  const smallInput = {
    domain,
    types: { ...domainTypes, S: [{ name: "text", type: "string" }] },
    primaryType: "S",
    message: { text: "hi" },
    origin,
  };

  it("accepts a payload within the floor", () => {
    expect(() => checkPolicyLimits(smallInput)).not.toThrow();
  });

  it("hashTypedData does not enforce policy limits - only checkPolicyLimits does", () => {
    const fields = Array.from({ length: 65 }, (_, i) => ({
      name: `f${i}`,
      type: "uint8",
    }));
    const message = Object.fromEntries(fields.map((f) => [f.name, 1]));
    const bigInput = {
      domain,
      types: { ...domainTypes, Big: fields },
      primaryType: "Big",
      message,
      origin,
    };

    expect(() => hashTypedDataHex(bigInput)).not.toThrow();
    expectCode(() => checkPolicyLimits(bigInput), "E_POLICY_LIMIT");
  });

  it("rejects more than 256 elements in a fixed array with E_POLICY_LIMIT", () => {
    const input = {
      domain,
      types: { ...domainTypes, Arr: [{ name: "items", type: "uint8[257]" }] },
      primaryType: "Arr",
      message: { items: Array.from({ length: 257 }, () => 1) },
      origin,
    };
    expectCode(() => checkPolicyLimits(input), "E_POLICY_LIMIT");
  });
});

describe("encoding boundaries", () => {
  it.each([
    ["a,uint8 b", "c"],
    ["a", "b,uint8 c"],
    ["", "c"],
    ["9a", "c"],
    ["a\n", "c"],
  ])("rejects non-identifier field names %j / %j", (first, second) => {
    expectCode(() => hashTypedData({
      domain, origin, primaryType: "S",
      types: { ...domainTypes, S: [first, second].map(name => ({ name, type: "uint8" })) },
      message: { [first]: 1, [second]: 2 },
    }), "E_FIELD_DEF");
  });

  const textInput = {
    domain, origin, primaryType: "S",
    types: { ...domainTypes, S: [{ name: "text", type: "string" }] },
    message: { text: "" },
  };

  it.each([
    ["high surrogate", { message: { text: "\ud800" } }],
    ["low surrogate", { message: { text: "\udfff" } }],
    ["domain", { domain: { ...domain, name: "\ud800" } }],
    ["origin", { origin: "\udfff" }],
  ])("rejects ill-formed Unicode in %s", (_label, overrides) => {
    expectCode(() => hashTypedData({ ...textInput, ...overrides }), "E_UTF8");
  });

  it("preserves valid Unicode without normalization", () => {
    const hashText = (text: string) => hashTypedDataHex({ ...textInput, message: { text } });
    expect(hashText("\ufffd")).toBe("0x7067f98b33dd88ed2bef97cea668e7d438ec0013e85ad89505845162fa1d720c");
    expect(() => hashText("\ud83d\ude00")).not.toThrow();
    expect(hashText("\u00e9")).not.toBe(hashText("e\u0301"));
  });

  it("returns an own typeHash for the valid __proto__ struct name", () => {
    const input = {
      domain, origin, primaryType: "__proto__",
      types: { ...domainTypes, ["__proto__"]: [] }, message: {},
    };
    const debug = hashTypedDataDebug(input);
    expect(Object.hasOwn(debug.typeHashes, "__proto__")).toBe(true);
    expect(debug.typeHashes["__proto__"]).toMatch(/^0x[0-9a-f]{64}$/);
    expect(debug.digestHex).toBe(hashTypedDataHex(input));
  });
});
