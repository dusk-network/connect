/**
 * Minimal EIP-1193-ish / JSON-RPC-ish error helpers.
 *
 * The injected Dusk provider rejects with an Error that may carry:
 * - error.code: number
 * - error.message: string
 * - error.data?: any
 */
export declare const ERROR_CODES: {
    readonly USER_REJECTED: 4001;
    readonly UNAUTHORIZED: 4100;
    readonly UNSUPPORTED: 4200;
    readonly DISCONNECTED: 4900;
    readonly INTERNAL: -32603;
    readonly INVALID_PARAMS: -32602;
    readonly METHOD_NOT_FOUND: -32601;
};
export type RpcErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES] | number;
export type RpcErrorLike = Error & {
    code?: RpcErrorCode;
    data?: unknown;
};
export declare class DuskSdkError extends Error {
    code?: RpcErrorCode;
    data?: unknown;
    constructor(message: string, opts?: {
        code?: RpcErrorCode;
        data?: unknown;
        cause?: unknown;
    });
}
export declare class DuskWalletNotInstalledError extends DuskSdkError {
    constructor(message?: string);
}
export declare class DuskWalletUnauthorizedError extends DuskSdkError {
    constructor(message?: string);
}
export declare class DuskWalletUserRejectedError extends DuskSdkError {
    constructor(message?: string);
}
export declare class DuskWalletDisconnectedError extends DuskSdkError {
    constructor(message?: string);
}
export declare function isRpcErrorLike(err: unknown): err is RpcErrorLike;
/**
 * Normalize an unknown error into an Error with optional `code` and `data`.
 *
 * - If it's already an Error, we keep it.
 * - If it's a string, we wrap it.
 * - Otherwise, we stringify best-effort.
 */
export declare function normalizeError(err: unknown, fallbackMessage?: string): RpcErrorLike;
/**
 * Convenience: create a JSON-RPC-like error.
 */
export declare function rpcError(code: RpcErrorCode, message: string, data?: unknown): RpcErrorLike;
//# sourceMappingURL=errors.d.ts.map