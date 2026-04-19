import { describe, expect, it } from "vitest";

import { inferTxError, inferTxOk, toTxWaitReceipt } from "./tx.js";

describe("internal tx helpers", () => {
  it("infers tx success from common payload shapes", () => {
    expect(inferTxOk({ success: true })).toBe(true);
    expect(inferTxOk({ success: false })).toBe(false);
    expect(inferTxOk({ err: "bad" })).toBe(false);
    expect(inferTxOk({ result: { error: "bad" } })).toBe(false);
    expect(inferTxOk("opaque")).toBe(true);
  });

  it("extracts nested error text best-effort", () => {
    expect(inferTxError({ err: "bad" })).toBe("bad");
    expect(inferTxError({ error: { message: "nested" } })).toBe("nested");
    expect(inferTxError({ result: { err: { code: 1 } } })).toContain("\"code\":1");
    expect(inferTxError(null)).toBe("");
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

    const failed = toTxWaitReceipt("0xghi", {
      headers: new Headers(),
      payload: { error: "reverted" },
    });
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("reverted");
  });
});
