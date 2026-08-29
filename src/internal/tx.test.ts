import { describe, expect, it, vi } from "vitest";

import { inferTxError, inferTxOk, toTxWaitReceipt, waitForTxReceipt } from "./tx.js";

const txHash = "0x" + "ab".repeat(32);

describe("internal tx helpers", () => {
  it("only reports success for recognized payloads", () => {
    expect(inferTxOk({ success: true })).toBe(true);
    expect(inferTxOk({ err: null, gas_spent: 100 })).toBe(true);
    expect(inferTxOk({ err: undefined })).toBeNull();
    expect(inferTxOk({ err: null, success: false })).toBe(false);
    expect(inferTxOk({ result: { success: true } })).toBe(true);
    expect(inferTxOk({ success: false })).toBe(false);
    expect(inferTxOk({ result: { success: false } })).toBe(false);
    expect(inferTxOk({ err: "bad" })).toBe(false);
    expect(inferTxOk({ result: { error: "bad" } })).toBe(false);
    expect(inferTxOk(null)).toBeNull();
    expect(inferTxOk(new Uint8Array([1]))).toBeNull();
    expect(inferTxOk({})).toBeNull();
    expect(inferTxOk("opaque")).toBeNull();
  });

  it("extracts nested error text best-effort", () => {
    expect(inferTxError({ err: "bad" })).toBe("bad");
    expect(inferTxError({ error: { message: "nested" } })).toBe("nested");
    expect(inferTxError({ result: { err: { code: 1 } } })).toContain("\"code\":1");
    expect(inferTxError(null)).toBe("");
  });

  it("waits for success, normalizes transport errors, and preserves aborts", async () => {
    const event = { headers: new Headers(), payload: { success: true } };
    await expect(
      waitForTxReceipt({ waitForTxExecuted: async () => event }, txHash)
    ).resolves.toMatchObject({ status: "executed", ok: true, event });

    const node = {
      waitForTxExecuted: async () => {
        throw new Error("socket down");
      },
    };
    await expect(waitForTxReceipt(node, txHash)).resolves.toMatchObject({
      status: "timeout",
      error: "Unable to track tx execution: socket down",
    });

    const controller = new AbortController();
    controller.abort();
    await expect(waitForTxReceipt(node, txHash, { signal: controller.signal })).rejects.toThrow("socket down");

    const waitForTxExecuted = vi.fn();
    await expect(waitForTxReceipt({ waitForTxExecuted }, "abc")).rejects.toThrow(/64 hex characters/);
    expect(waitForTxExecuted).not.toHaveBeenCalled();
  });

  it("builds timeout and executed receipts", () => {
    const timeout = toTxWaitReceipt("0xabc", null);
    expect(timeout.status).toBe("timeout");
    expect(timeout.ok).toBe(false);
    expect(timeout.error).toMatch(/timed out/i);

    const executed = toTxWaitReceipt("0xdef", {
      headers: new Headers(),
      payload: { success: true },
    });
    expect(executed.status).toBe("executed");
    expect(executed.ok).toBe(true);

    const unknown = toTxWaitReceipt("0xunknown", {
      headers: new Headers(),
      payload: new Uint8Array([1, 2, 3]),
    });
    expect(unknown).toMatchObject({
      status: "executed",
      ok: null,
      error: "Unrecognized transaction execution payload",
    });

    const failed = toTxWaitReceipt("0xghi", {
      headers: new Headers(),
      payload: { error: "reverted" },
    });
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("reverted");
  });
});
