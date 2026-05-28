import type { AccountId } from "../types.js";

/** Account enum used by DRC standards (EOA public key or contract id). */
/** DRC standard account union for external accounts and contract accounts. */
export type DrcAccount = { External: AccountId } | { Contract: string };
