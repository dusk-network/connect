import { describe, expect, it } from "vitest";

import {
  LUX_DECIMALS,
  LUX_SCALE,
  clampDecimals,
  formatLuxShort,
  formatLuxToDusk,
  parseDuskToLux,
  safeBigInt,
} from "./amount.js";

describe("amount helpers", () => {
  it("exposes the expected Lux scale", () => {
    expect(LUX_DECIMALS).toBe(9);
    expect(LUX_SCALE).toBe(1_000_000_000n);
  });

  it("safeBigInt returns a bigint or the fallback", () => {
    expect(safeBigInt("42")).toBe(42n);
    expect(safeBigInt("not-a-number", 9n)).toBe(9n);
  });

  it("formats Lux to DUSK with trimmed decimals", () => {
    expect(formatLuxToDusk("0")).toBe("0");
    expect(formatLuxToDusk("1000000000")).toBe("1");
    expect(formatLuxToDusk("1234500000")).toBe("1.2345");
    expect(formatLuxToDusk("12")).toBe("0.000000012");
  });

  it("returns the original input string on invalid formatting input", () => {
    expect(formatLuxToDusk("abc")).toBe("abc");
  });

  it("clamps decimals without adding noise", () => {
    expect(clampDecimals("12.340000", 4)).toBe("12.34");
    expect(clampDecimals("12.345678", 2)).toBe("12.34");
    expect(clampDecimals("99", 4)).toBe("99");
  });

  it("keeps very small non-zero values visible in short format", () => {
    expect(formatLuxShort("1", 2)).toBe("0.000000001");
    expect(formatLuxShort("1000000000", 2)).toBe("1");
    expect(formatLuxShort("1234567890", 4)).toBe("1.2345");
  });

  it("parses DUSK strings into Lux", () => {
    expect(parseDuskToLux("1")).toBe("1000000000");
    expect(parseDuskToLux("1.5")).toBe("1500000000");
    expect(parseDuskToLux("0.000000001")).toBe("1");
    expect(parseDuskToLux("1.1234567899")).toBe("1123456789");
  });

  it("rejects malformed user input", () => {
    expect(() => parseDuskToLux("")).toThrow(/invalid amount/i);
    expect(() => parseDuskToLux("-1")).toThrow(/invalid amount/i);
    expect(() => parseDuskToLux("abc")).toThrow(/invalid amount/i);
  });
});
