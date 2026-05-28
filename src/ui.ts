/**
 * Optional Dusk Connect UI helpers.
 *
 * This entrypoint exports the lightweight connect modal, app-kit helper, and
 * `<dusk-connect-button>` web component. The core wallet SDK does not require
 * these UI helpers.
 *
 * @example
 * ```ts
 * import { defineDuskConnectButton } from "@dusk/connect/ui";
 *
 * defineDuskConnectButton();
 * ```
 *
 * @module
 */

export * from "./ui/modal.js";
export * from "./ui/appkit.js";
export * from "./ui/connect-button.js";
