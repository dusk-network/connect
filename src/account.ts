import { bytesToHex, hexToBytes } from "./bytes.js";
import type { AccountId } from "./types.js";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const PUBLIC_KEY_BYTES = 96;
const MAX_ACCOUNT_CHARS = 132;

function decodeBase58(value: string): Uint8Array {
  if (typeof value !== "string" || !value || value.length > MAX_ACCOUNT_CHARS) {
    throw new Error("Invalid Base58 account");
  }

  let number = 0n;
  for (const character of value) {
    const digit = BASE58.indexOf(character);
    if (digit < 0) throw new Error("Invalid Base58 account");
    number = number * 58n + BigInt(digit);
  }

  let hex = number.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const bytes = number === 0n ? [] : hexToBytes(hex);
  const leadingZeros = value.match(/^1*/)?.[0].length ?? 0;
  return Uint8Array.from([...new Uint8Array(leadingZeros), ...bytes]);
}

function encodeBase58(bytes: Uint8Array): string {
  let number = 0n;
  for (const byte of bytes) number = number * 256n + BigInt(byte);

  let encoded = "";
  while (number > 0n) {
    encoded = BASE58.charAt(Number(number % 58n)) + encoded;
    number /= 58n;
  }

  let leadingZeros = 0;
  while (bytes[leadingZeros] === 0) leadingZeros++;
  return "1".repeat(leadingZeros) + encoded;
}

/** Convert a Base58 Moonlight account into its 0x-prefixed 96-byte public key. */
export function accountToHex(account: AccountId): string {
  const bytes = decodeBase58(account);
  if (bytes.length !== PUBLIC_KEY_BYTES) throw new Error("A Moonlight account must encode 96 bytes");
  return `0x${bytesToHex(bytes)}`;
}

/** Convert a 96-byte Moonlight public key into its canonical Base58 account. */
export function hexToAccount(publicKey: string): AccountId {
  if (typeof publicKey !== "string") throw new Error("Invalid public-key hex");
  let bytes: Uint8Array;
  try {
    bytes = hexToBytes(publicKey);
  } catch {
    throw new Error("Invalid public-key hex");
  }
  if (bytes.length !== PUBLIC_KEY_BYTES) throw new Error("A Moonlight public key must be 96 bytes");
  return encodeBase58(bytes);
}
