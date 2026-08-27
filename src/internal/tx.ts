import type { DuskNodeClient, TxExecutedEvent } from "../node.js";
import type { TxWaitReceipt, WaitForTxOptions } from "../types.js";

/** Infer the outcome reported by a RUES transaction event. */
export function inferTxOk(payload: unknown): boolean | null {
  if (!payload || typeof payload !== "object" || payload instanceof Uint8Array) {
    return null;
  }

  const value = payload as any;
  if (
    value.success === false ||
    value.result?.success === false ||
    value.error ||
    value.result?.err ||
    value.result?.error
  ) {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(value, "err")) {
    if (value.err === null) return true;
    if (value.err !== undefined) return false;
    return null;
  }
  if (value.success === true || value.result?.success === true) {
    return true;
  }
  return null;
}

/** Extract a best-effort error message from a RUES transaction event payload. */
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

/** Convert a raw execution event into Connect's receipt-like transaction result. */
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
  const error = ok === false
    ? inferTxError(executed.payload)
    : ok === null
      ? "Unrecognized transaction execution payload"
      : "";

  return {
    hash: h,
    status: ok === false ? "failed" : "executed",
    ok,
    ...(error ? { error } : {}),
    event: executed,
  };
}

/** Wait for execution and normalize transport failures into timeout receipts. */
export async function waitForTxReceipt(
  node: Pick<DuskNodeClient, "waitForTxExecuted">,
  hash: string,
  options?: WaitForTxOptions
): Promise<TxWaitReceipt> {
  let executed: TxExecutedEvent | null = null;
  let waitError: unknown = null;
  try {
    executed = await node.waitForTxExecuted(hash, options);
  } catch (error) {
    if (options?.signal?.aborted) throw error;
    waitError = error;
  }

  const receipt = toTxWaitReceipt(hash, executed);
  if (waitError && receipt.status === "timeout") {
    const message = waitError instanceof Error ? waitError.message : String(waitError);
    receipt.error = `Unable to track tx execution: ${message}`;
  }
  return receipt;
}
