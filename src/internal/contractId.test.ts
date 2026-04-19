import { describe, expect, it } from "vitest";

import { normalizeContractId0x } from "./contractId.js";

describe("normalizeContractId0x", () => {
  it("normalizes string and byte-array contract ids", () => {
    const bytes = new Uint8Array(32).map((_, index) => index);
    const hex = "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

    expect(normalizeContractId0x(hex.toUpperCase())).toBe(hex);
    expect(normalizeContractId0x(bytes)).toBe(hex);
    expect(normalizeContractId0x(Array.from(bytes))).toBe(hex);
  });

  it("rejects non-32-byte contract ids", () => {
    expect(() => normalizeContractId0x("0x1234")).toThrow(/32 bytes/i);
    expect(() => normalizeContractId0x(new Uint8Array([1, 2, 3]))).toThrow(/32 bytes/i);
  });
});
