import type { TxExecutedEvent } from "../node.js";
import type { TxWaitReceipt } from "../types.js";

export function inferTxOk(payload: unknown): boolean {
  // Best-effort: node/w3sper versions vary.
  // Common patterns:
  // - { success: false }
  // - { err: ... }
  // - { error: ... }
  // - { result: { err/error } }
  try {
    if (!payload || typeof payload !== "object") return true;
    const p: any = payload;
    if (p.success === false) return false;
    if (p.err) return false;
    if (p.error) return false;
    if (p.result?.err) return false;
    if (p.result?.error) return false;
    return true;
  } catch {
    return true;
  }
}

export function inferTxError(payload: unknown): string {
  try {
    if (!payload || typeof payload !== "object") return "";
    const p: any = payload;
    const err = p.err ?? p.error ?? p.result?.err ?? p.result?.error;
    if (!err) return "";
    if (typeof err === "string") return err;
    if (typeof err?.message === "string") return err.message;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  } catch {
    return "";
  }
}

export function toTxWaitReceipt(hash: string, executed: TxExecutedEvent | null): TxWaitReceipt {
  const h = String(hash ?? "");
  if (!executed) {
    return {
      hash: h,
      status: "timeout",
      ok: false,
      error: `Timed out waiting for tx execution (${h.slice(0, 12)}…)`,
    };
  }

  const ok = inferTxOk(executed.payload);
  const err = ok ? "" : inferTxError(executed.payload);

  return {
    hash: h,
    status: ok ? "executed" : "failed",
    ok,
    ...(err ? { error: err } : {}),
    event: executed,
  };
}
