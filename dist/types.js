/**
 * Types for the Dusk Wallet injected provider API.
 *
 * The wallet injects `window.dusk` with an EIP-1193-like interface.
 * All RPC methods are Dusk-prefixed (`dusk_*`).
 */
/**
 * Convenience preset ids understood by the wallet's switch RPC.
 *
 * NOTE: These are Dusk Wallet *presets* (not EVM chain ids). They are only
 * meaningful in the context of `dusk_switchChain` / `dusk_switchNetwork`.
 */
export const DUSK_CHAIN_PRESETS = {
    local: "dusk:0",
    mainnet: "dusk:1",
    testnet: "dusk:2",
    devnet: "dusk:3",
};
//# sourceMappingURL=types.js.map