import type { AccountId } from "../types.js";

/** Account enum used by DRC standards (EOA public key or contract id). */
export type DrcAccount = { External: AccountId } | { Contract: string };

