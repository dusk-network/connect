/**
 * Dusk Connect dApp SDK.
 *
 * Use this entrypoint for wallet discovery, profile permissions, public
 * balance reads, transaction submission, Dusk-native signing helpers, and
 * contract read/write helpers.
 *
 * @example Connect to the selected Dusk wallet
 * ```ts
 * import { createDuskWallet } from "@dusk/connect";
 *
 * const wallet = createDuskWallet();
 * await wallet.ready();
 * await wallet.connect();
 * console.log(wallet.state.selectedProfile);
 * ```
 *
 * @module
 */

export * from "./types.js";
export * from "./errors.js";
export * from "./amount.js";

export * from "./discovery.js";
export * from "./wallet.js";
export * from "./app.js";

// Optional helper
export * from "./ensureChain.js";

// Token/NFT standards (data-driver based)
export * from "./standards/types.js";
export * from "./standards/drc20.js";
export * from "./standards/drc721.js";
