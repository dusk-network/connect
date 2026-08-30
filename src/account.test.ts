import { describe, expect, it } from "vitest";

import { accountToHex, hexToAccount } from "./account.js";

const HEX = `0x${Array.from({ length: 96 }, (_, index) => index.toString(16).padStart(2, "0")).join("")}`;
const ACCOUNT = "15ZcCXvaS3urSGBx6VcrJeVq6p6LS2N8rmx98mF7zUXP1zxtbncLyRkdKvUj621CGCZipLZQwh9Ttjb43LMDUinGcY1CohNwc5rLn3tS34rCho7C1C4sc3dvU8hAGvBbvN";

describe("Moonlight account conversion", () => {
  it("converts known Base58 and hex representations both ways", () => {
    expect(accountToHex(ACCOUNT)).toBe(HEX);
    expect(hexToAccount(HEX)).toBe(ACCOUNT);
  });

  it("preserves leading zero bytes", () => {
    expect(hexToAccount(`0x${"00".repeat(96)}`)).toBe("1".repeat(96));
    expect(accountToHex("1".repeat(96))).toBe(`0x${"00".repeat(96)}`);
  });

  it("rejects malformed accounts and public keys", () => {
    expect(() => accountToHex("0OIl")).toThrow("Invalid Base58 account");
    expect(() => accountToHex("1")).toThrow("must encode 96 bytes");
    expect(() => hexToAccount("0xgg")).toThrow("Invalid public-key hex");
    expect(() => hexToAccount("0x00")).toThrow("must be 96 bytes");
  });
});
