import type { AccountId } from "../types.js";

/** Account enum used by DRC standards (EOA public key or contract id). */
/** DRC standard account union for external accounts and contract accounts. */
export type DrcAccount = { External: AccountId } | { Contract: string };

/**
 * A principal of the dusk-network/contracts standards, in its JSON form: a
 * Base58 Moonlight account, a Base58 Phoenix Schnorr key (not a wallet's
 * Phoenix address), or a contract id as 64 hex characters.
 */
export type DrcPrincipal = { Moonlight: AccountId } | { Phoenix: string } | { Contract: string };
