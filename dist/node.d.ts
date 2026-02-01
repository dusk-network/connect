export type ContractCallOptions = {
    /**
     * If true, force feeder mode. If false, disable feeder mode.
     * If omitted, the client will try without feeder and retry with feeder
     * when the node asks for it.
     */
    feeder?: boolean;
    /** AbortSignal for the underlying fetch */
    signal?: AbortSignal;
};
export type WaitForTxExecutedOptions = {
    /**
     * How long to wait for the tx to be executed before returning `null`.
     * Default: 60_000ms.
     */
    timeoutMs?: number;
    /** AbortSignal to cancel the wait. */
    signal?: AbortSignal;
};
export type TxExecutedEvent = {
    /** RUES headers for the executed event */
    headers: Headers;
    /** Decoded payload if JSON, otherwise a Uint8Array */
    payload: unknown;
};
export type DuskNodeClient = {
    /** Resolved base URL (no trailing slash) */
    getBaseUrl(): string;
    /**
     * Call a contract endpoint via Rusk HTTP.
     *
     * @returns raw bytes (RKYV) returned by the node.
     */
    contractCall(contractId: string, fnName: string, body: Uint8Array | ArrayBuffer | number[] | string, opts?: ContractCallOptions): Promise<Uint8Array>;
    /**
     * Wait until a tx hash is reported as **Executed** by the node (RUES).
     *
     * This is the lightweight, event-driven alternative to polling `/on/graphql/query`.
     *
     * Returns `null` on timeout.
     */
    waitForTxExecuted(hash: string, opts?: WaitForTxExecutedOptions): Promise<TxExecutedEvent | null>;
};
export declare function createDuskNodeClient(opts: {
    /** Base URL, e.g. https://testnet.nodes.dusk.network */
    baseUrl: string | (() => string);
    /** Optional fetch implementation for tests */
    fetch?: typeof fetch;
}): DuskNodeClient;
//# sourceMappingURL=node.d.ts.map