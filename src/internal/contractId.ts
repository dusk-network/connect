import { bytesToHex, hexToBytes } from "../bytes.js";

/** Normalize a contract id to a lowercase 0x-prefixed 32-byte hex string. */
export function normalizeContractId0x(input: string | Uint8Array | number[]): string {
  const bytes =
    typeof input === "string"
      ? hexToBytes(input)
      : input instanceof Uint8Array
        ? input
        : new Uint8Array(input);

  if (bytes.length !== 32) {
    throw new TypeError("contractId must be 32 bytes (0x + 64 hex chars)");
  }

  return "0x" + bytesToHex(bytes).toLowerCase();
}
