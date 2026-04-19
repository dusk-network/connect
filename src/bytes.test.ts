import { describe, expect, it } from "vitest";

import { bytesToHex, hexToBytes, isHexString, toBytes } from "./bytes.js";

describe("byte helpers", () => {
  it("recognizes valid even-length hex strings", () => {
    expect(isHexString("0aFF")).toBe(true);
    expect(isHexString("abc")).toBe(false);
    expect(isHexString("zz")).toBe(false);
  });

  it("converts hex to bytes and back", () => {
    const bytes = hexToBytes("0x0aff10");
    expect([...bytes]).toEqual([0x0a, 0xff, 0x10]);
    expect(bytesToHex(bytes)).toBe("0aff10");
  });

  it("supports ArrayBuffer and number[] inputs for bytesToHex", () => {
    expect(bytesToHex([0, 16, 255])).toBe("0010ff");
    expect(bytesToHex(new Uint8Array([1, 2, 3]).buffer)).toBe("010203");
  });

  it("normalizes supported byte-like values", () => {
    expect([...toBytes("0x0aff")]).toEqual([0x0a, 0xff]);
    expect([...toBytes("0aff")]).toEqual([0x0a, 0xff]);
    expect([...toBytes([1, 2, 3])]).toEqual([1, 2, 3]);
    expect([...toBytes(new Uint8Array([4, 5]))]).toEqual([4, 5]);
    expect([...toBytes(new Uint8Array([6, 7]).buffer)]).toEqual([6, 7]);
    expect([...toBytes(null)]).toEqual([]);
  });

  it("rejects invalid hex or unsupported encodings", () => {
    expect(() => hexToBytes("0xz1")).toThrow(/invalid hex/i);
    expect(() => toBytes({ nope: true })).toThrow(/unsupported byte encoding/i);
  });
});
