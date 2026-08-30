# Dusk Typed Data v1 — normative specification

**Status:** Draft. Not frozen.
**Scheme identifier:** `DUSK_TYPED_DATA_V1`
**Supersedes:** all earlier `v1` drafts and golden vectors. See [Changes from the pre-freeze draft](#changes-from-the-pre-freeze-draft).

This document is the single source of truth for the Dusk typed-data digest. Every
implementation — the Connect reference (`@dusk/connect`), the wallet twin
(`src/shared/typedDataHash.js`), and any contract-side or relayer verifier — MUST
produce byte-identical digests and MUST agree on which inputs are valid.

Where this document says MUST, MUST NOT, SHOULD, SHOULD NOT, MAY, the terms carry
their RFC 2119 meanings.

---

## 1. Scope

Dusk typed data lets a dApp ask a wallet to sign **structured, human-renderable
data** instead of an opaque digest. It is the Dusk analogue of EIP-712 /
`eth_signTypedData_v4`, not of `eth_sign`.

It is deliberately **not** wire-compatible with EIP-712: different hash function
(SHA-256, not keccak-256), different curve and signature scheme (BLS12-381 short
signatures, not secp256k1 ECDSA), different type encoding. Familiarity is the
only thing borrowed.

### 1.1 Goals

- A verifier that holds the payload can recompute the digest independently.
- The requesting web origin is bound into the digest by the **wallet**, not the caller.
- The encoded form is a function of the **type**, not the **value**, so no
  implementation needs a size budget to agree with any other.
- The signed message space is disjoint from every other message the same key signs.

### 1.2 Non-goals

- Ethereum tooling compatibility.
- Replacing transaction approval. A typed-data signature never moves funds by itself.
- Decoding arbitrary contract calldata.

---

## 2. Terminology

| Term | Meaning |
|------|---------|
| **atomic type** | One of `string`, `bytes`, `bytes32`, `uint64`, `uint32`, `uint8`, `bool` |
| **struct type** | A named entry in `types` whose value is a list of field definitions |
| **array type** | `T[n]` for a fixed `n ≥ 1`, where `T` is any non-array type |
| **field definition** | `{ "name": <identifier>, "type": <type expression> }` |
| **identifier** | A string matching `^[A-Za-z_][A-Za-z0-9_]*$` |
| **signer** | An implementation that produces signatures (the wallet) |
| **verifier** | An implementation that checks signatures (Connect, a relayer, a contract) |

All byte strings are big-endian unless stated. `sha256(x)` denotes SHA-256 over
byte string `x`, producing exactly 32 bytes. `utf8(s)` denotes the UTF-8 encoding
of Unicode string `s`. `a || b` denotes concatenation.

---

## 3. Input

```jsonc
{
  "domain": {
    "name":    "<string>",
    "version": "<string>",
    "chainId": "<string>",           // CAIP-2, e.g. "dusk:1"
    "verifyingContract": "<0x-hex>"  // OPTIONAL, exactly 32 bytes when present
  },
  "types": {
    "DuskTypedDataDomain": [ /* canonical, see §7 */ ],
    "<StructName>": [ { "name": "...", "type": "..." }, ... ]
  },
  "primaryType": "<StructName>",
  "message":     { /* value of primaryType */ },
  "origin":      "<string>"          // injected by the signer, see §8
}
```

`origin` is **not** a caller-supplied field at the RPC boundary. The signer
overwrites any caller-supplied value. See §8.

---

## 4. Type expressions

A type expression is exactly one of:

1. An atomic type name.
2. A struct type name — an identifier that is a key of `types`.
3. `T[n]` where `T` is an atomic or struct type name and `n` matches `^[1-9][0-9]*$`.

Nested arrays (`T[n][m]`) are permitted; the inner expression is parsed first.

Implementations MUST reject:

- Any type expression containing whitespace.
- Dynamic arrays (`T[]`), including any expression containing `[]`.
- Zero-length arrays (`T[0]`) and arrays with leading zeros in `n` (`T[01]`).
- A struct type name that is not a key of `types`.
- A struct type name that is not a valid identifier.

### 4.1 Encoded width

Every type has a width determined statically from the type expression alone:

| Type | Width (bytes) |
|------|---------------|
| `bool` | 1 |
| `uint8` | 1 |
| `uint32` | 4 |
| `uint64` | 8 |
| `bytes32` | 32 |
| `string` | 32 |
| `bytes` | 32 |
| struct | 32 |
| `T[n]` | `n × width(T)` |

This is the central property of v1: **encoded size never depends on the value.**
Implementations therefore do not need, and MUST NOT apply, a value-dependent size
budget as a validity rule. See §11.

---

## 5. Value encoding

`encodeValue(T, v)` produces exactly `width(T)` bytes.

### 5.1 Atomics

| Type | Accepted JSON | Encoding |
|------|---------------|----------|
| `bool` | boolean only | `0x01` if true, `0x00` if false |
| `uint8` | see §5.2 | 1-byte big-endian |
| `uint32` | see §5.2 | 4-byte big-endian |
| `uint64` | see §5.2 | 8-byte big-endian |
| `bytes32` | `0x`-hex string decoding to **exactly** 32 bytes | the 32 raw bytes |
| `string` | string only | `sha256(utf8(v))` |
| `bytes` | `0x`-hex string, any length including empty | `sha256(rawBytes)` |

Hex decoding: an optional `0x` or `0X` prefix MAY be present; the remainder MUST
have even length and contain only `[0-9a-fA-F]`. `bytes32` MUST NOT be
zero-padded or truncated — a value that does not decode to exactly 32 bytes is
rejected, not adjusted.

Strings are hashed over their UTF-8 bytes with **no normalization**. Implementations
MUST NOT apply NFC, NFD, case folding, or whitespace trimming. Two strings that
differ by a combining-character sequence are different values.

`sha256("")` is a well-defined constant, so an empty `string` and an empty `bytes`
both encode to `e3b0c442...b855`. This is not a collision: field types are pinned
by `typeHash` (§6.2), which is the first 32 bytes of every struct preimage.

### 5.2 Unsigned integers

A `uintN` value MUST be either:

- a JSON **number** that is an integer and satisfies `Number.isSafeInteger`
  (i.e. `|v| ≤ 2^53 − 1`), or
- a JSON **string** matching `^(0|[1-9][0-9]*)$` (decimal, no sign, no leading zeros).

The value MUST be `≥ 0` and `≤ 2^N − 1`.

Callers SHOULD use the decimal-string form for any `uint64` value, and MUST use it
above `2^53 − 1`. The JSON-number path is accepted for ergonomics only; it cannot
represent the full `uint64` range and MUST NOT be silently widened.

### 5.3 Arrays

`encodeValue(T[n], v)`: `v` MUST be a JSON array of exactly `n` elements. The
encoding is the concatenation of `encodeValue(T, v[i])` for `i` in `0..n-1`.

### 5.4 Structs

`encodeValue(S, v)` where `S` is a struct type is `structHash(S, v)` — see §6.3.
`v` MUST be a JSON object (not `null`, not an array).

---

## 6. Type and struct hashing

### 6.1 encodeType

`encodeTypeLocal(S)` is the string:

```
S(t1 n1,t2 n2,...,tk nk)
```

where `ti`/`ni` are the declared type and name of the `i`-th field of `S`, in
declaration order, joined by `,` with no spaces except the single space between
each type and name.

`deps(S)` is the set of struct type names reachable from `S` by following field
types, unwrapping array types, transitively, **including `S` itself**.

`encodeType(S)` is:

```
encodeTypeLocal(S)  ||  concat( encodeTypeLocal(D) for D in sorted(deps(S) \ {S}) )
```

The primary type comes **first**; remaining dependencies follow, sorted ascending
by type name comparing UTF-8 bytes.

> **Note.** Sorting by type name and sorting by the full `encodeTypeLocal` string
> are equivalent here, because `(` is `0x28`, which is below every byte legal in an
> identifier (`0`=0x30, `A`=0x41, `_`=0x5F, `a`=0x61), and type names are unique
> within `types`. Implementations MAY sort by either key. This spec states the
> name-sorted form because it matches EIP-712's wording.

### 6.2 typeHash

```
typeHash(S) = sha256( utf8( encodeType(S) ) )
```

### 6.3 structHash

```
structHash(S, v) = sha256( typeHash(S) || encodeValue(t1, v[n1]) || ... || encodeValue(tk, v[nk]) )
```

fields in declaration order.

Field presence MUST be tested as an **own** property of `v` — never via prototype
chain lookup (`in` in JavaScript, `hasattr` on a class instance, etc.). Every field
declared by `S` MUST be present; any key of `v` not declared by `S` MUST be rejected.

---

## 7. Domain

`types` MUST contain a `DuskTypedDataDomain` entry equal to exactly:

```json
[
  { "name": "name",              "type": "string" },
  { "name": "version",           "type": "string" },
  { "name": "chainId",           "type": "string" },
  { "name": "verifyingContract", "type": "bytes32" }
]
```

Same fields, same types, same order, no additions. Any deviation is rejected.

The canonical domain value is:

```
{
  name:              domain.name,
  version:           domain.version,
  chainId:           domain.chainId,
  verifyingContract: domain.verifyingContract ?? "0x0000...0000"   // 32 zero bytes
}
```

`name`, `version`, and `chainId` MUST be strings. `verifyingContract`, when
present, MUST be a string; it is encoded as `bytes32` per §5.1, so it MUST decode
to exactly 32 bytes. Omitting it is exactly equivalent to supplying 32 zero bytes.

```
domainSeparator = structHash("DuskTypedDataDomain", canonicalDomain)
```

`primaryType` MUST NOT be `DuskTypedDataDomain`.

---

## 8. Origin binding

```
ORIGIN_TAG = utf8("DUSK_ORIGIN_BIND_V1\0")        // 20 bytes
originBind = sha256( ORIGIN_TAG || sha256(utf8(origin)) )
```

`origin` MUST be a string. It is supplied by the **signer**, from its own trusted
view of the requesting context — for a browser extension, the origin of the page
that issued the RPC.

A signer MUST ignore and overwrite any `origin` field present in caller-supplied
parameters. A caller that could set `origin` could obtain a signature attributable
to a site it does not control.

Signers MUST NOT normalize the origin (no trailing-slash addition or removal, no
case folding, no default-port stripping) beyond what the host platform already
guarantees. The exact string used MUST be returned to the caller (§13) so that a
verifier reconstructs it rather than guessing.

Non-browser signers MAY use the empty string when no web origin exists. The empty
string is a distinct, well-defined binding — it is not a wildcard, and a verifier
MUST NOT treat it as matching any origin.

---

## 9. Digest

```
PREAMBLE = utf8("DUSK_TYPED_DATA_V1\0")           // 19 bytes

digest = sha256(
    PREAMBLE                                       // 19 bytes
 || domainSeparator                                // 32 bytes
 || originBind                                     // 32 bytes
 || structHash(primaryType, message)               // 32 bytes
)                                                  // = 115-byte preimage
```

The preimage is fixed-length, so the four components are unambiguously positioned
and no length prefixes are required.

---

## 10. Validation

The following are **normative rejects**. Implementations MUST reject all of them,
MUST NOT coerce or repair, and SHOULD report the stable error code so that two
implementations disagreeing can be diagnosed.

| Code | Condition |
|------|-----------|
| `E_PARAMS_SHAPE` | Input is not an object; `types`, `domain`, or `message` is not a non-array object |
| `E_PRIMARY_MISSING` | `primaryType` absent, not a string, or not a key of `types` |
| `E_PRIMARY_INVALID` | `primaryType` is an atomic, an array type, not an identifier, or is `DuskTypedDataDomain` |
| `E_DOMAIN_TYPE` | `types.DuskTypedDataDomain` absent or not exactly the canonical field list (§7) |
| `E_DOMAIN_VALUE` | `domain.name`/`version`/`chainId` not strings, or `verifyingContract` present and not a string |
| `E_TYPE_UNKNOWN` | A referenced struct type is not a key of `types` |
| `E_TYPE_INVALID` | Type expression contains whitespace, is `T[]`, is `T[0]`, has leading zeros in `n`, or names a non-identifier |
| `E_TYPE_CYCLE` | The struct dependency graph reachable from `primaryType` or `DuskTypedDataDomain` contains a cycle |
| `E_FIELD_DUP` | Two fields of one struct share a name |
| `E_FIELD_RESERVED` | A field is named `__proto__`, `constructor`, or `prototype` |
| `E_FIELD_DEF` | A field definition's `name` or `type` is not a string |
| `E_FIELD_MISSING` | A declared field is not an own property of the value |
| `E_FIELD_EXTRA` | The value has an own property not declared by its struct type |
| `E_VALUE_TYPE` | Value's JSON type does not match the declared type (§5.1) |
| `E_ARRAY_LENGTH` | Array value's length ≠ the declared `n` |
| `E_UINT_RANGE` | Integer negative, above `2^N − 1`, or a JSON number that is not a safe integer |
| `E_UINT_FORMAT` | Integer string does not match `^(0\|[1-9][0-9]*)$` |
| `E_HEX_FORMAT` | Hex string has odd length or non-hex characters |
| `E_BYTES32_LENGTH` | `bytes32` value does not decode to exactly 32 bytes |
| `E_ORIGIN_TYPE` | `origin` is not a string |

Type cycles (`E_TYPE_CYCLE`) admit no finite value, so they were previously
unreachable in practice. They are rejected explicitly so that validity does not
rest on an unstated invariant, and so the error is reported at the type level
rather than as a confusing `E_FIELD_MISSING` deep in recursion.

Reserved field names (`E_FIELD_RESERVED`) are rejected because prototype-chain
lookup for those names succeeds on an empty object in several languages,
which would let a declared field appear present when it is absent.

---

## 11. Limits

Encoded size is a function of the type (§4.1), so **no size limit is part of digest
validity**. This is a deliberate change from the pre-freeze draft, where a 1 MiB
encoded-size budget was normative and the two reference implementations diverged
on how to count it.

Instead, this spec defines a **floor**, not a ceiling:

| Dimension | Floor |
|-----------|-------|
| Distinct struct types per payload | 32 |
| Fields per struct | 64 |
| Nesting depth (struct or array) | 8 |
| Elements per fixed array | 256 |
| Bytes per `string` or `bytes` value | 65 536 |
| Total decoded input | 262 144 |

Rules:

- **Verifiers MUST accept** any otherwise-valid payload within the floor.
- **Signers SHOULD reject** payloads exceeding the floor, as local policy, with an
  error distinguishable from the §10 validation codes (suggested: `E_POLICY_LIMIT`).
- Implementations MAY accept payloads above the floor, but a signer that does so
  risks producing signatures a conforming verifier is not obliged to check. Signers
  SHOULD NOT.
- Limits MUST NOT influence the digest. Two implementations that both accept a
  payload MUST produce the same digest regardless of their limits.

This confines resource policy to the transport boundary, where implementations may
differ safely, and keeps it out of the consensus rules, where they may not.

---

## 12. Signing and verification

### 12.1 Signed message

The signature is **not** computed over the bare digest. It is computed over:

```
SIG_TAG        = utf8("DUSK_TYPED_DATA_SIG_V1\0")      // 23 bytes
signedMessage  = SIG_TAG || digest                     // 55 bytes
```

Rationale: the digest is 32 bytes and therefore indistinguishable from any other
32-byte value the same key might be asked to sign — including Moonlight pay-auth
digests. The tag makes the typed-data message space structurally disjoint from
every 32-byte message space, so an implementation that signs raw 32-byte digests
cannot forge a typed-data signature, and vice versa.

The tag is applied outside the digest because a value inside the SHA-256 preimage
does not constrain the *output*, which is what actually gets signed.

### 12.2 Algorithm

```
sk        = profile Moonlight BLS12-381 secret key
DST       = "BLS_SIG_BLS12381G1_XMD:SHA-256_DUSK_V2"
signature = sk · hashToCurve_G1(signedMessage, DST)      // 48-byte compressed G1
publicKey = 96-byte compressed G2 point
```

The DST is the standard Dusk `BlsVersion::V2` domain separation tag, unchanged.
This keeps signatures verifiable by the stock dusk-core verification path, which
does not accept a caller-supplied DST. `hashToCurve` accepts arbitrary-length
input, so the 55-byte tagged message needs no special handling.

### 12.3 Verification

A verifier MUST:

1. Recompute `digest` from the payload — including the `origin` the signer reports,
   not one the verifier assumes.
2. Recompute `signedMessage = SIG_TAG || digest`.
3. Verify the short signature over `signedMessage` under the standard DST.
4. Check `domain.chainId` against the chain it is verifying for.
5. Check `origin` against its own policy. An origin that does not match expectation
   MUST fail verification even when the signature is cryptographically valid.

A verifier MUST NOT verify over the bare digest. Doing so would accept signatures
produced by any raw-32-byte signing path.

---

## 13. Result shape

A signer returns:

```jsonc
{
  "account":       "<base58 Moonlight account>",
  "publicKeyHex":  "0x<96-byte compressed G2>",
  "origin":        "<exact origin string used in the digest>",
  "chainId":       "<CAIP-2 chain the signer was on>",
  "primaryType":   "<primaryType that was signed>",
  "digestHex":     "0x<32-byte bare digest>",
  "signature":     "0x<48-byte compressed G1>"
}
```

`origin` MUST be echoed. It is a digest input the caller does not control, and a
verifier that guesses it wrong cannot distinguish a normalization mismatch from a
tampered signature.

`digestHex` is the **bare** digest (§9), suitable for display and for a caller to
cross-check. The signature covers `SIG_TAG || digest` (§12.1), not this value.

`account` and `publicKeyHex` are two encodings of the same key: `account` is the
base58 form used throughout the rest of the provider surface, `publicKeyHex` is the
raw form a verifier passes to the BLS library.

---

## 14. Versioning

- A wallet advertises `signTypedDataVersions: [1]` — an **array**, so that a future
  version can be added without breaking callers that speak only v1, and so that
  retiring a version is detectable by callers rather than surfacing as an opaque
  runtime rejection.
- A caller MAY send `params.version`. It defaults to `1`. A signer MUST reject a
  version it does not implement rather than falling back silently, so that a caller
  which precomputed a digest locally gets a clear error instead of a mismatch.
- **Freeze rule.** `DUSK_TYPED_DATA_V1` is frozen at the first release published to
  an extension store or tagged on a public package. Before that point, vectors may
  be regenerated. After it, any change to §5–§9 requires a new scheme identifier.

---

## 15. Test vectors

Golden vectors are the interoperability contract. They live in one place and are
mirrored, never re-derived. Every vector MUST carry intermediates, not only the
final digest — a mismatch must localize to a stage.

Each **accept** vector:

```jsonc
{
  "description": "...",
  "input":       { "domain": …, "types": …, "primaryType": …, "message": …, "origin": … },
  "typeHashes":  { "<StructName>": "0x…" },
  "domainSeparator": "0x…",
  "originBind":      "0x…",
  "structHash":      "0x…",
  "digestHex":       "0x…",
  "signedMessageHex":"0x…"
}
```

Each **reject** vector: `{ "description", "input", "error": "E_…" }`.

Required accept coverage: minimal string struct; nested struct; `bytes32` field
with non-zero `verifyingContract`; domain without `verifyingContract`; fixed array;
nested fixed array; empty `string`; empty `bytes`; `uint64` at `2^64 − 1` as
decimal string; `uint64` as JSON number; multi-byte and combining-character UTF-8
string; struct reached through an array element.

Required reject coverage: one vector per §10 error code.

---

## Changes from the pre-freeze draft

| Change | Reason |
|--------|--------|
| `string` and `bytes` encode as `sha256(value)` instead of `len32(value) \|\| value` | Makes encoded width a function of the type, removing the need for a normative size budget — the two reference implementations had diverged on how to count it, so each accepted payloads the other rejected |
| Normative 1 MiB encoded-size cap removed; §11 floor added | Resource policy belongs at the transport boundary, not in validity rules |
| `encodeType` prepends the primary type before sorted dependencies | Previously, two struct types with equal dependency-closure *sets* shared a `typeHash`. Only reachable for mutually recursive types, which admit no finite value — but the safety argument was implicit and unenforced |
| Type cycles rejected explicitly (`E_TYPE_CYCLE`) | Removes reliance on the above invariant; better error locality |
| Field presence via own-property lookup only | `in` succeeds via the prototype chain for `__proto__`, `constructor`, `toString`, so a declared field could appear present while absent |
| `__proto__`, `constructor`, `prototype` rejected as field names | Defence in depth for the same class of issue across languages |
| `primaryType` may not be `DuskTypedDataDomain` | No use case; produced a confusing approval screen |
| `originBind` hashes the origin instead of length-prefixing it | Consistency with §5.1 — one rule for variable-length input |
| Signature covers `SIG_TAG \|\| digest` rather than the bare digest | Makes the typed-data message space disjoint from 32-byte digest spaces signed by the same key under the same DST |
| Signing DST unchanged | A custom DST would break verification via the stock dusk-core path, which does not accept a caller-supplied DST |
| Result echoes `origin`, `chainId`, `primaryType`; `fundsPkHex` renamed `publicKeyHex`; `signatureHex` renamed `signature` | `origin` is a digest input the caller cannot derive reliably; the other names align with `dusk_signMessage` and `dusk_signAuth` |
| Capability is `signTypedDataVersions: [1]` | A scalar forces a flag-day migration when v2 ships |
| Stable error codes (§10) | Two implementations must agree on *why* they reject, not only *that* they reject |
