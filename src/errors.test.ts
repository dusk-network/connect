import { describe, expect, it } from "vitest";

import {
  DuskSdkError,
  DuskWalletDisconnectedError,
  DuskWalletNotInstalledError,
  DuskWalletUnauthorizedError,
  DuskWalletUserRejectedError,
  ERROR_CODES,
  isRpcErrorLike,
  normalizeError,
  rpcError,
} from "./errors.js";

describe("error helpers", () => {
  it("creates typed SDK errors", () => {
    const err = new DuskSdkError("boom", { code: ERROR_CODES.INTERNAL, data: { x: 1 } });
    expect(err.name).toBe("DuskSdkError");
    expect(err.code).toBe(ERROR_CODES.INTERNAL);
    expect(err.data).toEqual({ x: 1 });
  });

  it("provides wallet-specific error subclasses", () => {
    expect(new DuskWalletNotInstalledError().code).toBe(ERROR_CODES.UNSUPPORTED);
    expect(new DuskWalletUnauthorizedError().code).toBe(ERROR_CODES.UNAUTHORIZED);
    expect(new DuskWalletUserRejectedError().code).toBe(ERROR_CODES.USER_REJECTED);
    expect(new DuskWalletDisconnectedError().code).toBe(ERROR_CODES.DISCONNECTED);
  });

  it("detects rpc-like errors", () => {
    expect(isRpcErrorLike({ message: "x", code: 1 })).toBe(true);
    expect(isRpcErrorLike(new Error("x"))).toBe(true);
    expect(isRpcErrorLike({ code: 1 })).toBe(false);
  });

  it("normalizes unknown errors", () => {
    const original = Object.assign(new Error("bad"), { code: 4100 });
    const circular: any = {};
    circular.self = circular;
    expect(normalizeError(original)).toBe(original);
    expect(normalizeError("plain text")).toBeInstanceOf(DuskSdkError);
    expect(normalizeError({ foo: "bar" }).message).toContain("foo");
    expect(normalizeError(circular, "fallback").message).toBe("fallback");
  });

  it("creates rpc-style errors with codes and data", () => {
    const err = rpcError(ERROR_CODES.INVALID_PARAMS, "invalid", { field: "amount" });
    expect(err).toBeInstanceOf(DuskSdkError);
    expect(err.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(err.data).toEqual({ field: "amount" });
  });
});
