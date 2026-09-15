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
export * from "./account.js";

export {
  DUSK_REQUEST_PROVIDER_EVENT, DUSK_ANNOUNCE_PROVIDER_EVENT,
  DUSK_SELECTED_PROVIDER_STORAGE_KEY, DUSK_PROVIDER_INFO_FIELDS,
  isDuskProvider, isDuskProviderInfo, isDuskProviderDetail,
  normalizeDuskProviderInfo, normalizeDuskProviderDetail,
  makeDuskAnnounceProviderEvent, makeDuskRequestProviderEvent, announceDuskProvider,
  requestDuskProviders, waitForDuskProviders, subscribeDuskProviders,
  type RequestDuskProvidersOptions, type WaitForDuskProvidersOptions,
  type DuskProviderDiscoveryListener,
} from "./discovery.js";
export * from "./wallet.js";
export * from "./app.js";

// Optional helper
export * from "./ensureChain.js";

// Token/NFT standards (data-driver based)
export * from "./standards/types.js";
export * from "./standards/drc20.js";
export * from "./standards/drc721.js";
