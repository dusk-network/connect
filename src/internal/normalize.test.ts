import { describe, expect, it } from "vitest";

import { compact, normalizeBaseUrl, normalizeCaip2ChainId, strip0x } from "./normalize.js";

describe("internal normalize helpers", () => {
  it("normalizes base urls by trimming and removing trailing slashes", () => {
    expect(normalizeBaseUrl(" https://example.com/// ")).toBe("https://example.com");
    expect(normalizeBaseUrl("")).toBe("");
  });

  it("normalizes valid CAIP-2 dusk chain ids", () => {
    expect(normalizeCaip2ChainId("DUSK:2")).toBe("dusk:2");
    expect(normalizeCaip2ChainId(" dusk:001 ")).toBe("dusk:001");
    expect(normalizeCaip2ChainId("eth:1")).toBe("");
    expect(normalizeCaip2ChainId("dusk:not-a-number")).toBe("");
  });

  it("strips optional 0x prefixes", () => {
    expect(strip0x("0xabc")).toBe("abc");
    expect(strip0x("0Xabc")).toBe("abc");
    expect(strip0x("abc")).toBe("abc");
  });

  it("removes only undefined keys when compacting", () => {
    expect(compact({ a: 1, b: undefined, c: null, d: false })).toEqual({
      a: 1,
      c: null,
      d: false,
    });
  });
});
