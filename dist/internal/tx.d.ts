import type { TxExecutedEvent } from "../node.js";
import type { TxWaitReceipt } from "../types.js";
export declare function inferTxOk(payload: unknown): boolean;
export declare function inferTxError(payload: unknown): string;
export declare function toTxWaitReceipt(hash: string, executed: TxExecutedEvent | null): TxWaitReceipt;
//# sourceMappingURL=tx.d.ts.map