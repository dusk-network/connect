/**
 * Minimal EIP-1193-ish / JSON-RPC-ish error helpers.
 *
 * The injected Dusk provider rejects with an Error that may carry:
 * - error.code: number
 * - error.message: string
 * - error.data?: any
 */

export const ERROR_CODES = {
  USER_REJECTED: 4001,
  UNAUTHORIZED: 4100,
  UNSUPPORTED: 4200,
  DISCONNECTED: 4900,
  INTERNAL: -32603,
  INVALID_PARAMS: -32602,
  METHOD_NOT_FOUND: -32601,
} as const;

export type RpcErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES] | number;

export type RpcErrorLike = Error & {
  code?: RpcErrorCode;
  data?: unknown;
};

export class DuskSdkError extends Error {
  code?: RpcErrorCode;
  data?: unknown;

  constructor(message: string, opts?: { code?: RpcErrorCode; data?: unknown; cause?: unknown }) {
    super(message);
    this.name = "DuskSdkError";
    if (opts?.cause !== undefined) {
      // `cause` is part of the ES2022 Error spec; we attach best-effort.
      (this as any).cause = opts.cause;
    }
    if (opts?.code !== undefined) this.code = opts.code;
    if (opts?.data !== undefined) this.data = opts.data;
  }
}

export class DuskWalletNotInstalledError extends DuskSdkError {
  constructor(message = "Dusk Wallet not detected") {
    super(message, { code: ERROR_CODES.UNSUPPORTED });
    this.name = "DuskWalletNotInstalledError";
  }
}

export class DuskWalletUnauthorizedError extends DuskSdkError {
  constructor(message = "Dusk Wallet is locked or the site is not connected") {
    super(message, { code: ERROR_CODES.UNAUTHORIZED });
    this.name = "DuskWalletUnauthorizedError";
  }
}

export class DuskWalletUserRejectedError extends DuskSdkError {
  constructor(message = "User rejected the request") {
    super(message, { code: ERROR_CODES.USER_REJECTED });
    this.name = "DuskWalletUserRejectedError";
  }
}

export class DuskWalletDisconnectedError extends DuskSdkError {
  constructor(message = "Dusk Wallet provider is disconnected") {
    super(message, { code: ERROR_CODES.DISCONNECTED });
    this.name = "DuskWalletDisconnectedError";
  }
}

export function isRpcErrorLike(err: unknown): err is RpcErrorLike {
  return (
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof (err as any).message === "string" &&
    ("code" in err ? typeof (err as any).code === "number" : true)
  );
}

/**
 * Normalize an unknown error into an Error with optional `code` and `data`.
 *
 * - If it's already an Error, we keep it.
 * - If it's a string, we wrap it.
 * - Otherwise, we stringify best-effort.
 */
export function normalizeError(err: unknown, fallbackMessage = "Unknown error"): RpcErrorLike {
  if (isRpcErrorLike(err)) return err;

  if (err instanceof Error) {
    return err as RpcErrorLike;
  }

  if (typeof err === "string") {
    return new DuskSdkError(err) as RpcErrorLike;
  }

  try {
    return new DuskSdkError(JSON.stringify(err)) as RpcErrorLike;
  } catch {
    return new DuskSdkError(fallbackMessage) as RpcErrorLike;
  }
}

/**
 * Convenience: create a JSON-RPC-like error.
 */
export function rpcError(code: RpcErrorCode, message: string, data?: unknown): RpcErrorLike {
  const err = new DuskSdkError(message, { code, data });
  return err as RpcErrorLike;
}
