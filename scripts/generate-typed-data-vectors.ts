/**
 * Generator for the Dusk typed-data v1 golden vector corpus.
 *
 * Normative spec: docs/typed-data-v1.md, section 15 ("Test vectors").
 *
 * Vectors are the interoperability contract between this repo and the wallet
 * twin (`wallet/src/shared/typedDataHash.js`). They MUST NOT be hand-edited -
 * every file under `vectors/typed-data-v1/` (accept) and
 * `vectors/typed-data-v1/reject/` (reject) is derived from the declarative
 * lists below, computed with this repo's own `hashTypedDataDebug` /
 * `hashTypedData`, so a vector can never assert a digest the reference
 * implementation didn't actually produce.
 *
 * Usage:
 *   node scripts/generate-typed-data-vectors.ts
 *
 * `buildAcceptVectorFiles` / `buildRejectVectorFiles` are also imported
 * in-memory by src/typed-data/vectors.generated.test.ts, which asserts the
 * committed JSON is byte-identical to what this script would produce - so a
 * hash change with stale committed vectors fails CI instead of drifting
 * silently.
 */
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// NOTE: this file is executed directly by Node's native TypeScript support
// (`node scripts/generate-typed-data-vectors.ts`), which requires resolvable
// specifiers - hence the `.ts` extension here, unlike the `.js`-suffixed
// imports used inside src/ for tsc/bundler (NodeNext/Bundler) resolution.
import {
  hashTypedData,
  hashTypedDataDebug,
  TypedDataError,
  type HashTypedDataInput,
  type TypedDataErrorCode,
} from "../src/typed-data/hash.ts";
import { bytesToHex, hexToBytes } from "../src/bytes.ts";
import { register } from "node:module";

// src/bls/sig.ts (which exports the SIG_TAG constant this generator reuses,
// per spec 12.1) is itself written with `.js`-suffixed relative specifiers
// (e.g. `from "../bytes.js"`), the convention `src/` uses for tsc/bundler
// (Bundler moduleResolution) consumers - both this repo's own build and the
// vitest-based regeneration test (vectors.generated.test.ts) understand that
// convention. Node's native TypeScript execution, used when this file is run
// directly (`node scripts/generate-typed-data-vectors.ts`), does not: it
// resolves specifiers literally, so `sig.ts`'s own `"../bytes.js"` fails to
// resolve (no `bytes.js` file exists, only `bytes.ts`). Rather than editing
// sig.ts's specifiers (out of scope - it's shared, tsc/bundler-consumed
// source), register a narrow resolution hook that retries a relative `.js`
// specifier as `.ts` only when the literal `.js` file doesn't exist. This
// only affects resolution performed by Node's own ESM loader, so it is a
// no-op under vitest, which resolves this file's imports through Vite's own
// module graph rather than Node's loader.
register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, nextResolve) {
      if (specifier.startsWith(".") && specifier.endsWith(".js")) {
        try {
          return await nextResolve(specifier, context);
        } catch (err) {
          if (err && err.code === "ERR_MODULE_NOT_FOUND") {
            return nextResolve(specifier.slice(0, -3) + ".ts", context);
          }
          throw err;
        }
      }
      return nextResolve(specifier, context);
    }
  `)}`,
  import.meta.url
);

// Dynamic + awaited so it runs after the resolution hook above is
// registered - a static `import ... from "../src/bls/sig.ts"` would resolve
// (and fail) before this module's body ever runs.
const { TYPED_DATA_SIG_TAG }: { TYPED_DATA_SIG_TAG: string } = await import("../src/bls/sig.ts");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ACCEPT_DIR = path.join(ROOT, "vectors/typed-data-v1");
const REJECT_DIR = path.join(ACCEPT_DIR, "reject");

const ZERO32 = `0x${"00".repeat(32)}`;

// Spec section 12.1: signedMessage = SIG_TAG || digest (55 bytes). Reuses the
// single source of truth for SIG_TAG (src/bls/sig.ts) rather than
// re-declaring the tag string here, so there is exactly one definition of
// the tag in the repo.
const SIG_TAG_BYTES = new TextEncoder().encode(TYPED_DATA_SIG_TAG);

/** `0x` + 110 lowercase hex chars: "0x" || hex(SIG_TAG || digest) (spec 12.1). */
function signedMessageHexFromDigestHex(digestHex: `0x${string}`): `0x${string}` {
  const digestBytes = hexToBytes(digestHex);
  const signedMessageBytes = new Uint8Array(SIG_TAG_BYTES.length + digestBytes.length);
  signedMessageBytes.set(SIG_TAG_BYTES, 0);
  signedMessageBytes.set(digestBytes, SIG_TAG_BYTES.length);
  return `0x${bytesToHex(signedMessageBytes)}`;
}

const DOMAIN_TYPES = {
  DuskTypedDataDomain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "string" },
    { name: "verifyingContract", type: "bytes32" },
  ],
};

// ---------------------------------------------------------------------------
// Accept vectors
// ---------------------------------------------------------------------------

type AcceptSpec = {
  file: string;
  description: string;
  input: HashTypedDataInput;
};

const ACCEPT_VECTORS: AcceptSpec[] = [
  // The following three are the original golden vectors; their `input` is
  // reproduced verbatim (same domain/types/message/origin values) so the
  // digests below never change. They now flow through the same generator
  // as every other vector, so they can no longer drift by hand-edit.
  {
    file: "sign_in_basic.json",
    description:
      "minimal SignIn-like: domain + string fields; origin as given (no trailing-slash normalization)",
    input: {
      domain: { name: "Example", version: "1", chainId: "dusk:1" },
      types: {
        ...DOMAIN_TYPES,
        SignIn: [
          { name: "address", type: "string" },
          { name: "statement", type: "string" },
        ],
      },
      primaryType: "SignIn",
      message: { address: "dusk1example", statement: "Sign in to Example" },
      origin: "https://app.example",
    },
  },
  {
    file: "nested_struct.json",
    description:
      "nested struct Apple inside Envelope; encodeType(Envelope) puts Envelope's own encodeType first, then sorted dependencies (Apple)",
    input: {
      domain: { name: "Nest", version: "1", chainId: "dusk:1" },
      types: {
        ...DOMAIN_TYPES,
        Apple: [{ name: "name", type: "string" }],
        Envelope: [
          { name: "inner", type: "Apple" },
          { name: "note", type: "string" },
        ],
      },
      primaryType: "Envelope",
      message: { inner: { name: "fuji" }, note: "hello" },
      origin: "https://app.example",
    },
  },
  {
    file: "bytes32_field.json",
    description: "bytes32 field plus non-zero verifyingContract; origin exact (no slash normalize)",
    input: {
      domain: {
        name: "Lock",
        version: "1",
        chainId: "dusk:1",
        verifyingContract: "0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20",
      },
      types: {
        ...DOMAIN_TYPES,
        Lock: [
          { name: "assetId", type: "bytes32" },
          { name: "amount", type: "uint64" },
        ],
      },
      primaryType: "Lock",
      message: {
        assetId: "0xaabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
        amount: "42",
      },
      origin: "https://app.example",
    },
  },
  {
    file: "fixed_array.json",
    description: "fixed array field (uint32[3]), including the max uint32 value",
    input: {
      domain: { name: "Array", version: "1", chainId: "dusk:1" },
      types: {
        ...DOMAIN_TYPES,
        Numbers: [{ name: "values", type: "uint32[3]" }],
      },
      primaryType: "Numbers",
      message: { values: [1, 2, 4294967295] },
      origin: "https://app.example",
    },
  },
  {
    file: "nested_fixed_array.json",
    description:
      "nested fixed array uint8[2][3]: T[n][m] parses the inner expression first (spec section 4), so this is an array of 3 arrays of 2 uint8",
    input: {
      domain: { name: "Grid", version: "1", chainId: "dusk:1" },
      types: {
        ...DOMAIN_TYPES,
        Grid: [{ name: "cells", type: "uint8[2][3]" }],
      },
      primaryType: "Grid",
      message: { cells: [[1, 2], [3, 4], [5, 6]] },
      origin: "https://app.example",
    },
  },
  {
    file: "struct_array_element.json",
    description: "struct type reached through an array element (Item[2] inside Basket)",
    input: {
      domain: { name: "Basket", version: "1", chainId: "dusk:1" },
      types: {
        ...DOMAIN_TYPES,
        Item: [{ name: "label", type: "string" }],
        Basket: [{ name: "items", type: "Item[2]" }],
      },
      primaryType: "Basket",
      message: { items: [{ label: "apple" }, { label: "pear" }] },
      origin: "https://app.example",
    },
  },
  {
    file: "empty_string.json",
    description: 'empty string field: encodes as sha256(""), a well-defined constant (spec section 5.1)',
    input: {
      domain: { name: "Note", version: "1", chainId: "dusk:1" },
      types: {
        ...DOMAIN_TYPES,
        Note: [{ name: "text", type: "string" }],
      },
      primaryType: "Note",
      message: { text: "" },
      origin: "https://app.example",
    },
  },
  {
    file: "empty_bytes.json",
    description: 'empty bytes field ("0x"): also encodes as sha256(""), disambiguated from string by typeHash',
    input: {
      domain: { name: "Blob", version: "1", chainId: "dusk:1" },
      types: {
        ...DOMAIN_TYPES,
        Blob: [{ name: "data", type: "bytes" }],
      },
      primaryType: "Blob",
      message: { data: "0x" },
      origin: "https://app.example",
    },
  },
  {
    file: "uint64_max_decimal_string.json",
    description: "uint64 at its maximum value 2^64-1, given as a decimal string (required above 2^53-1)",
    input: {
      domain: { name: "Counter", version: "1", chainId: "dusk:1" },
      types: {
        ...DOMAIN_TYPES,
        Counter: [{ name: "n", type: "uint64" }],
      },
      primaryType: "Counter",
      message: { n: "18446744073709551615" },
      origin: "https://app.example",
    },
  },
  {
    file: "uint64_safe_number.json",
    description:
      "uint64 given as a JSON number instead of a string, at the top of the safe-integer range (Number.MAX_SAFE_INTEGER = 2^53-1); the JSON-number path cannot represent the full uint64 range (spec section 5.2), so this intentionally does not reuse the 2^64-1 value from uint64_max_decimal_string.json",
    input: {
      domain: { name: "Counter", version: "1", chainId: "dusk:1" },
      types: {
        ...DOMAIN_TYPES,
        Counter: [{ name: "n", type: "uint64" }],
      },
      primaryType: "Counter",
      message: { n: 9007199254740991 },
      origin: "https://app.example",
    },
  },
  {
    file: "multi_byte_utf8_string.json",
    description:
      "multi-byte UTF-8 string containing a combining-character sequence (e + U+0301 combining acute) and an emoji; hashed over raw UTF-8 bytes with no normalization (spec section 5.1)",
    input: {
      domain: { name: "Message", version: "1", chainId: "dusk:1" },
      types: {
        ...DOMAIN_TYPES,
        Message: [{ name: "text", type: "string" }],
      },
      primaryType: "Message",
      message: { text: "Café \u{1F600} Zurich" },
      origin: "https://app.example",
    },
  },
  {
    file: "all_atomic_types.json",
    description: "every atomic type (string, bytes, bytes32, uint64, uint32, uint8, bool) in one struct",
    input: {
      domain: { name: "Kitchen", version: "1", chainId: "dusk:1" },
      types: {
        ...DOMAIN_TYPES,
        Sink: [
          { name: "s", type: "string" },
          { name: "b", type: "bytes" },
          { name: "b32", type: "bytes32" },
          { name: "u64", type: "uint64" },
          { name: "u32", type: "uint32" },
          { name: "u8", type: "uint8" },
          { name: "flag", type: "bool" },
        ],
      },
      primaryType: "Sink",
      message: {
        s: "hello",
        b: "0xdeadbeef",
        b32: `0x${"11".repeat(32)}`,
        u64: "1234567890123456789",
        u32: 4000000000,
        u8: 255,
        flag: true,
      },
      origin: "https://app.example",
    },
  },
  {
    file: "empty_origin.json",
    description:
      "empty origin string: a non-browser signer's well-defined binding for no web origin, distinct from any real origin (spec section 8)",
    input: {
      domain: { name: "Ping", version: "1", chainId: "dusk:1" },
      types: {
        ...DOMAIN_TYPES,
        Ping: [{ name: "nonce", type: "uint8" }],
      },
      primaryType: "Ping",
      message: { nonce: 7 },
      origin: "",
    },
  },
];

// ---------------------------------------------------------------------------
// Reject vectors - one per spec section 10 error code
// ---------------------------------------------------------------------------

type RejectSpec = {
  file: string;
  description: string;
  input: unknown;
  error: TypedDataErrorCode;
};

const BASE_DOMAIN = { name: "Example", version: "1", chainId: "dusk:1" };
const BASE_ORIGIN = "https://app.example";

function typesWith(extra: Record<string, Array<{ name: string; type: string }>>) {
  return { ...DOMAIN_TYPES, ...extra };
}

const REJECT_VECTORS: RejectSpec[] = [
  {
    file: "e_params_shape.json",
    description: "input is not an object at all (a bare string)",
    input: "nope",
    error: "E_PARAMS_SHAPE",
  },
  {
    file: "e_primary_missing.json",
    description: "primaryType is absent from the input",
    input: {
      domain: BASE_DOMAIN,
      types: typesWith({ S: [{ name: "text", type: "string" }] }),
      message: { text: "hi" },
      origin: BASE_ORIGIN,
    },
    error: "E_PRIMARY_MISSING",
  },
  {
    file: "e_primary_invalid.json",
    description: "primaryType is an atomic type name, not a struct",
    input: {
      domain: BASE_DOMAIN,
      types: typesWith({ S: [{ name: "text", type: "string" }] }),
      primaryType: "string",
      message: {},
      origin: BASE_ORIGIN,
    },
    error: "E_PRIMARY_INVALID",
  },
  {
    file: "e_domain_type.json",
    description: "types.DuskTypedDataDomain is missing entirely",
    input: {
      domain: BASE_DOMAIN,
      types: { S: [{ name: "text", type: "string" }] },
      primaryType: "S",
      message: { text: "hi" },
      origin: BASE_ORIGIN,
    },
    error: "E_DOMAIN_TYPE",
  },
  {
    file: "e_domain_value.json",
    description: "domain.name is a JSON number, not a string",
    input: {
      domain: { name: 123, version: "1", chainId: "dusk:1" },
      types: typesWith({ S: [{ name: "text", type: "string" }] }),
      primaryType: "S",
      message: { text: "hi" },
      origin: BASE_ORIGIN,
    },
    error: "E_DOMAIN_VALUE",
  },
  {
    file: "e_type_unknown.json",
    description: "a field type references a struct name that is not a key of types",
    input: {
      domain: BASE_DOMAIN,
      types: typesWith({ S: [{ name: "inner", type: "Undeclared" }] }),
      primaryType: "S",
      message: { inner: {} },
      origin: BASE_ORIGIN,
    },
    error: "E_TYPE_UNKNOWN",
  },
  {
    file: "e_type_invalid.json",
    description: "dynamic array type T[] is rejected (only fixed T[n] is permitted)",
    input: {
      domain: BASE_DOMAIN,
      types: typesWith({ S: [{ name: "items", type: "uint8[]" }] }),
      primaryType: "S",
      message: { items: [1] },
      origin: BASE_ORIGIN,
    },
    error: "E_TYPE_INVALID",
  },
  {
    file: "e_type_cycle.json",
    description: "a self-referencing struct type admits no finite value",
    input: {
      domain: BASE_DOMAIN,
      types: typesWith({ A: [{ name: "next", type: "A" }] }),
      primaryType: "A",
      message: { next: {} },
      origin: BASE_ORIGIN,
    },
    error: "E_TYPE_CYCLE",
  },
  {
    file: "e_field_dup.json",
    description: "two fields of one struct share the same name",
    input: {
      domain: BASE_DOMAIN,
      types: typesWith({
        S: [
          { name: "text", type: "string" },
          { name: "text", type: "string" },
        ],
      }),
      primaryType: "S",
      message: { text: "hi" },
      origin: BASE_ORIGIN,
    },
    error: "E_FIELD_DUP",
  },
  {
    file: "e_field_reserved.json",
    description: "a field is declared with the reserved name __proto__",
    input: {
      domain: BASE_DOMAIN,
      types: typesWith({ S: [{ name: "__proto__", type: "string" }] }),
      primaryType: "S",
      // Bracket/computed form: a literal `{ __proto__: "hi" }` would trigger
      // prototype-setting semantics (the value isn't an object, so the
      // assignment is silently dropped) instead of creating an own property.
      message: { ["__proto__"]: "hi" },
      origin: BASE_ORIGIN,
    },
    error: "E_FIELD_RESERVED",
  },
  {
    file: "e_field_def.json",
    description: "a field definition is missing its type",
    input: {
      domain: BASE_DOMAIN,
      types: typesWith({ S: [{ name: "text" } as unknown as { name: string; type: string }] }),
      primaryType: "S",
      message: { text: "hi" },
      origin: BASE_ORIGIN,
    },
    error: "E_FIELD_DEF",
  },
  {
    file: "e_field_missing.json",
    description: "a declared field is not present on the message value",
    input: {
      domain: BASE_DOMAIN,
      types: typesWith({
        S: [
          { name: "a", type: "string" },
          { name: "b", type: "string" },
        ],
      }),
      primaryType: "S",
      message: { a: "hi" },
      origin: BASE_ORIGIN,
    },
    error: "E_FIELD_MISSING",
  },
  {
    file: "e_field_extra.json",
    description: "the message value has an own property not declared by its struct type",
    input: {
      domain: BASE_DOMAIN,
      types: typesWith({ S: [{ name: "text", type: "string" }] }),
      primaryType: "S",
      message: { text: "hi", bogus: "nope" },
      origin: BASE_ORIGIN,
    },
    error: "E_FIELD_EXTRA",
  },
  {
    file: "e_value_type.json",
    description: "a bool field is given a JSON string instead of a boolean",
    input: {
      domain: BASE_DOMAIN,
      types: typesWith({ S: [{ name: "flag", type: "bool" }] }),
      primaryType: "S",
      message: { flag: "true" },
      origin: BASE_ORIGIN,
    },
    error: "E_VALUE_TYPE",
  },
  {
    file: "e_array_length.json",
    description: "a fixed array value's length does not match the declared n",
    input: {
      domain: BASE_DOMAIN,
      types: typesWith({ S: [{ name: "items", type: "uint8[3]" }] }),
      primaryType: "S",
      message: { items: [1, 2] },
      origin: BASE_ORIGIN,
    },
    error: "E_ARRAY_LENGTH",
  },
  {
    file: "e_uint_range.json",
    description: "a uint8 value exceeds 2^8-1",
    input: {
      domain: BASE_DOMAIN,
      types: typesWith({ S: [{ name: "n", type: "uint8" }] }),
      primaryType: "S",
      message: { n: 256 },
      origin: BASE_ORIGIN,
    },
    error: "E_UINT_RANGE",
  },
  {
    file: "e_uint_format.json",
    description: "a uint decimal string has a leading zero",
    input: {
      domain: BASE_DOMAIN,
      types: typesWith({ S: [{ name: "n", type: "uint64" }] }),
      primaryType: "S",
      message: { n: "007" },
      origin: BASE_ORIGIN,
    },
    error: "E_UINT_FORMAT",
  },
  {
    file: "e_hex_format.json",
    description: "a bytes value has odd-length hex",
    input: {
      domain: BASE_DOMAIN,
      types: typesWith({ S: [{ name: "b", type: "bytes" }] }),
      primaryType: "S",
      message: { b: "0xabc" },
      origin: BASE_ORIGIN,
    },
    error: "E_HEX_FORMAT",
  },
  {
    file: "e_bytes32_length.json",
    description: "a bytes32 value does not decode to exactly 32 bytes",
    input: {
      domain: BASE_DOMAIN,
      types: typesWith({ S: [{ name: "b", type: "bytes32" }] }),
      primaryType: "S",
      message: { b: "0xaabb" },
      origin: BASE_ORIGIN,
    },
    error: "E_BYTES32_LENGTH",
  },
  {
    file: "e_origin_type.json",
    description: "origin is a JSON number, not a string",
    input: {
      domain: BASE_DOMAIN,
      types: typesWith({ S: [{ name: "text", type: "string" }] }),
      primaryType: "S",
      message: { text: "hi" },
      origin: 12345,
    },
    error: "E_ORIGIN_TYPE",
  },
];

// ---------------------------------------------------------------------------
// Build (pure - no filesystem access) and write
// ---------------------------------------------------------------------------

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Pure: computes { filename: fileContents } for every accept vector. Never touches disk. */
export function buildAcceptVectorFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const spec of ACCEPT_VECTORS) {
    const debug = hashTypedDataDebug(spec.input);
    out[spec.file] = serialize({
      description: spec.description,
      input: spec.input,
      typeHashes: debug.typeHashes,
      domainSeparator: debug.domainSeparator,
      originBind: debug.originBind,
      structHash: debug.structHash,
      digestHex: debug.digestHex,
      signedMessageHex: signedMessageHexFromDigestHex(debug.digestHex),
    });
  }
  return out;
}

/**
 * Pure: computes { filename: fileContents } for every reject vector. Never
 * touches disk. Asserts (throws) if the implementation does not actually
 * reject the input with the expected code, so a vector can never assert a
 * rejection the implementation doesn't produce.
 */
export function buildRejectVectorFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const spec of REJECT_VECTORS) {
    let caught: unknown;
    try {
      hashTypedData(spec.input as HashTypedDataInput);
    } catch (err) {
      caught = err;
    }
    if (!(caught instanceof TypedDataError)) {
      throw new Error(
        `generator: ${spec.file} (${spec.error}) did not throw TypedDataError - got ${String(caught)}`
      );
    }
    if (caught.code !== spec.error) {
      throw new Error(
        `generator: ${spec.file} expected code ${spec.error} but implementation threw ${caught.code}`
      );
    }
    out[spec.file] = serialize({
      description: spec.description,
      input: spec.input,
      error: spec.error,
    });
  }
  return out;
}

/** Every §10 error code must have exactly one reject vector. Guards against silent gaps. */
const ALL_CODES: TypedDataErrorCode[] = [
  "E_PARAMS_SHAPE",
  "E_PRIMARY_MISSING",
  "E_PRIMARY_INVALID",
  "E_DOMAIN_TYPE",
  "E_DOMAIN_VALUE",
  "E_TYPE_UNKNOWN",
  "E_TYPE_INVALID",
  "E_TYPE_CYCLE",
  "E_FIELD_DUP",
  "E_FIELD_RESERVED",
  "E_FIELD_DEF",
  "E_FIELD_MISSING",
  "E_FIELD_EXTRA",
  "E_VALUE_TYPE",
  "E_ARRAY_LENGTH",
  "E_UINT_RANGE",
  "E_UINT_FORMAT",
  "E_HEX_FORMAT",
  "E_BYTES32_LENGTH",
  "E_ORIGIN_TYPE",
];

export function checkRejectCoverage(): void {
  const covered = new Set(REJECT_VECTORS.map((v) => v.error));
  const missing = ALL_CODES.filter((c) => !covered.has(c));
  if (missing.length > 0) {
    throw new Error(`generator: missing reject vector(s) for: ${missing.join(", ")}`);
  }
}

function main(): void {
  checkRejectCoverage();

  const acceptFiles = buildAcceptVectorFiles();
  const rejectFiles = buildRejectVectorFiles();

  mkdirSync(ACCEPT_DIR, { recursive: true });
  mkdirSync(REJECT_DIR, { recursive: true });

  for (const [name, contents] of Object.entries(acceptFiles)) {
    writeFileSync(path.join(ACCEPT_DIR, name), contents);
  }
  for (const [name, contents] of Object.entries(rejectFiles)) {
    writeFileSync(path.join(REJECT_DIR, name), contents);
  }

  // Remove stale accept-vector files that are no longer in ACCEPT_VECTORS, so
  // the directory listing never silently retains a vector nothing generates
  // anymore. (Never touches src/, only vectors/typed-data-v1/**.)
  const acceptNames = new Set(Object.keys(acceptFiles));
  for (const entry of readdirSync(ACCEPT_DIR, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".json") && !acceptNames.has(entry.name)) {
      console.warn(`generator: stale accept vector not in declarative list: ${entry.name}`);
    }
  }
  const rejectNames = new Set(Object.keys(rejectFiles));
  for (const entry of readdirSync(REJECT_DIR, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".json") && !rejectNames.has(entry.name)) {
      console.warn(`generator: stale reject vector not in declarative list: ${entry.name}`);
    }
  }

  console.log(
    `generated ${Object.keys(acceptFiles).length} accept vector(s) and ${Object.keys(rejectFiles).length} reject vector(s)`
  );
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
