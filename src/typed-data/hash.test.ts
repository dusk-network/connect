import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  checkPolicyLimits,
  hashTypedData,
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
  it.each(["sign_in_basic.json", "nested_struct.json", "bytes32_field.json"])(
    "matches golden digest for %s",
    (name) => {
      const vector = loadVector(name);
      expect(hashTypedDataHex(vector.input)).toBe(vector.digestHex);
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
  it('encodes an empty string field as sha256("")', () => {
    const digest = hashTypedDataHex({
      domain,
      types: { ...domainTypes, S: [{ name: "text", type: "string" }] },
      primaryType: "S",
      message: { text: "" },
      origin,
    });
    expect(digest.startsWith("0x")).toBe(true);
    expect(digest).toHaveLength(66);
  });

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
  it("accepts max uint64 as decimal string", () => {
    const digest = hashTypedDataHex({
      domain,
      types: { ...domainTypes, U: [{ name: "n", type: "uint64" }] },
      primaryType: "U",
      message: { n: "18446744073709551615" },
      origin,
    });
    expect(digest.startsWith("0x")).toBe(true);
    expect(digest).toHaveLength(66);
  });

  it("accepts safe JSON number for uint64", () => {
    const digest = hashTypedDataHex({
      domain,
      types: { ...domainTypes, U: [{ name: "n", type: "uint64" }] },
      primaryType: "U",
      message: { n: 9007199254740991 },
      origin,
    });
    expect(digest.startsWith("0x")).toBe(true);
    expect(digest).toHaveLength(66);
  });

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

  it("rejects leading-zero decimal string for uint64 with E_UINT_FORMAT", () => {
    expectCode(
      () =>
        hashTypedDataHex({
          domain,
          types: { ...domainTypes, U: [{ name: "n", type: "uint64" }] },
          primaryType: "U",
          message: { n: "007" },
          origin,
        }),
      "E_UINT_FORMAT"
    );
  });
});

describe("validation error codes (spec section 10)", () => {
  it("E_PARAMS_SHAPE: params is not an object", () => {
    expectCode(() => hashTypedData("nope" as any), "E_PARAMS_SHAPE");
  });

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

  it("E_PRIMARY_INVALID: primaryType is an atomic type", () => {
    expectCode(
      () =>
        hashTypedData({
          domain,
          types: { ...domainTypes, S: [{ name: "text", type: "string" }] },
          primaryType: "string",
          message: {},
          origin,
        }),
      "E_PRIMARY_INVALID"
    );
  });

  it("E_DOMAIN_VALUE: domain.name is not a string", () => {
    expectCode(
      () =>
        hashTypedData({
          domain: { ...domain, name: 123 as any },
          types: { ...domainTypes, S: [{ name: "text", type: "string" }] },
          primaryType: "S",
          message: { text: "hi" },
          origin,
        }),
      "E_DOMAIN_VALUE"
    );
  });

  it("E_TYPE_UNKNOWN: field references an undeclared struct type", () => {
    expectCode(
      () =>
        hashTypedData({
          domain,
          types: { ...domainTypes, S: [{ name: "inner", type: "Undeclared" }] },
          primaryType: "S",
          message: { inner: {} },
          origin,
        }),
      "E_TYPE_UNKNOWN"
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

  it("E_TYPE_INVALID: dynamic array T[]", () => {
    expectCode(
      () =>
        hashTypedData({
          domain,
          types: { ...domainTypes, S: [{ name: "items", type: "uint8[]" }] },
          primaryType: "S",
          message: { items: [1] },
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

  it("E_TYPE_CYCLE: self-referencing struct type", () => {
    expectCode(
      () =>
        hashTypedData({
          domain,
          types: { ...domainTypes, A: [{ name: "next", type: "A" }] },
          primaryType: "A",
          message: { next: {} },
          origin,
        }),
      "E_TYPE_CYCLE"
    );
  });

  it("E_FIELD_DUP: duplicate field name in one struct", () => {
    expectCode(
      () =>
        hashTypedData({
          domain,
          types: {
            ...domainTypes,
            S: [
              { name: "text", type: "string" },
              { name: "text", type: "string" },
            ],
          },
          primaryType: "S",
          message: { text: "hi" },
          origin,
        }),
      "E_FIELD_DUP"
    );
  });

  it("E_FIELD_RESERVED: field declared __proto__", () => {
    expectCode(
      () =>
        hashTypedData({
          domain,
          types: { ...domainTypes, S: [{ name: "__proto__", type: "string" }] },
          primaryType: "S",
          message: { ["__proto__"]: "hi" },
          origin,
        }),
      "E_FIELD_RESERVED"
    );
  });

  it("E_FIELD_DEF: field definition missing a type", () => {
    expectCode(
      () =>
        hashTypedData({
          domain,
          types: { ...domainTypes, S: [{ name: "text" } as any] },
          primaryType: "S",
          message: { text: "hi" },
          origin,
        }),
      "E_FIELD_DEF"
    );
  });

  it("E_FIELD_MISSING: field is present only via the prototype chain, not as an own property", () => {
    const vector = loadVector("sign_in_basic.json");
    const message = Object.assign(Object.create({ address: "via-prototype" }), {
      statement: "Sign in to Example",
    });
    expectCode(() => hashTypedData({ ...vector.input, message }), "E_FIELD_MISSING");
  });

  it("E_FIELD_EXTRA: value has an own property not declared by its struct type", () => {
    expectCode(
      () =>
        hashTypedData({
          domain,
          types: { ...domainTypes, S: [{ name: "text", type: "string" }] },
          primaryType: "S",
          message: { text: "hi", bogus: "nope" },
          origin,
        }),
      "E_FIELD_EXTRA"
    );
  });

  it("E_VALUE_TYPE: bool field given a string value", () => {
    expectCode(
      () =>
        hashTypedData({
          domain,
          types: { ...domainTypes, S: [{ name: "flag", type: "bool" }] },
          primaryType: "S",
          message: { flag: "true" },
          origin,
        }),
      "E_VALUE_TYPE"
    );
  });

  it("E_ARRAY_LENGTH: fixed array value has the wrong length", () => {
    expectCode(
      () =>
        hashTypedData({
          domain,
          types: { ...domainTypes, S: [{ name: "items", type: "uint8[3]" }] },
          primaryType: "S",
          message: { items: [1, 2] },
          origin,
        }),
      "E_ARRAY_LENGTH"
    );
  });

  it("E_HEX_FORMAT: bytes value has odd hex length", () => {
    expectCode(
      () =>
        hashTypedData({
          domain,
          types: { ...domainTypes, S: [{ name: "b", type: "bytes" }] },
          primaryType: "S",
          message: { b: "0xabc" },
          origin,
        }),
      "E_HEX_FORMAT"
    );
  });

  it("E_BYTES32_LENGTH: bytes32 value does not decode to exactly 32 bytes", () => {
    expectCode(
      () =>
        hashTypedData({
          domain,
          types: { ...domainTypes, S: [{ name: "b", type: "bytes32" }] },
          primaryType: "S",
          message: { b: "0xaabb" },
          origin,
        }),
      "E_BYTES32_LENGTH"
    );
  });

  it("E_ORIGIN_TYPE: origin is not a string", () => {
    expectCode(
      () =>
        hashTypedData({
          domain,
          types: { ...domainTypes, S: [{ name: "text", type: "string" }] },
          primaryType: "S",
          message: { text: "hi" },
          origin: 12345 as any,
        }),
      "E_ORIGIN_TYPE"
    );
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
