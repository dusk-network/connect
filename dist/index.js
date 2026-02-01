// Public entrypoint.
//
// Keep the surface area intentionally small:
// - wallet (connection + tx send)
// - app facade (read/write contract helpers)
// - core types + a couple of amount helpers
export * from "./types.js";
export * from "./errors.js";
export * from "./amount.js";
export * from "./wallet.js";
export * from "./app.js";
// Optional helper
export * from "./ensureChain.js";
//# sourceMappingURL=index.js.map