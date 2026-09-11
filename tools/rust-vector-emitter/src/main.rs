//! Emit the Dusk BLS cross-implementation vectors from the *Rust* side.
//!
//! Derivation is transcribed from rusk `wallet-core/src/keys/mod.rs`
//! (`derive_bls_sk`, `rng_with_index`); signing uses `bls12_381-bls` 0.6.0
//! directly, which is the same crate `dusk_core::signatures::bls` re-exports
//! and the same `sk.sign()` that `BlsVersion::V2` dispatches to.

use bls12_381_bls::{PublicKey, SecretKey};
use dusk_bytes::Serializable;
use rand_chacha::rand_core::SeedableRng;
use rand_chacha::ChaCha12Rng;
use sha2::{Digest, Sha256};

/// rusk `rng_with_index(seed, index, b"SK")`
fn rng_with_index(seed: &[u8], index: u8, termination: &[u8]) -> ChaCha12Rng {
    let index = u64::from(index);
    let mut hash = Sha256::new();
    hash.update(seed);
    hash.update(index.to_le_bytes());
    hash.update(termination);
    ChaCha12Rng::from_seed(hash.finalize().into())
}

/// rusk `derive_bls_sk(seed, index)`
fn derive_bls_sk(seed: &[u8], index: u8) -> SecretKey {
    SecretKey::random(&mut rng_with_index(seed, index, b"SK"))
}

fn hex(bytes: &[u8]) -> String {
    let mut out = String::from("0x");
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

fn unhex(s: &str) -> Vec<u8> {
    let body = s.strip_prefix("0x").unwrap_or(s);
    (0..body.len() / 2)
        .map(|i| u8::from_str_radix(&body[i * 2..i * 2 + 2], 16).unwrap())
        .collect()
}

const SIG_TAG: &[u8] = b"DUSK_TYPED_DATA_SIG_V1\0";

/// (name, seed hex, profile index, digest hex)
const CASES: &[(&str, &str, u8, &str)] = &[
    (
        "anchor_zero_seed_index_42",
        "0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
        42,
        "0x0000000000000000000000000000000000000000000000000000000000000000",
    ),
    (
        "patterned_seed_index_1",
        "0x000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f",
        1,
        "0xa5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5",
    ),
    (
        "typed_data_digest_nested_struct",
        "0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
        0,
        "0x085c40ef06d26efbc57e58b996ea367e458f1477775a066ea895f040e4b12029",
    ),
    (
        "zero_seed_index_0",
        "0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
        0,
        "0x1111111111111111111111111111111111111111111111111111111111111111",
    ),
    (
        "zero_seed_index_255",
        "0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
        255,
        "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    ),
];

fn main() {
    println!("{{");
    for (i, (name, seed_hex, index, digest_hex)) in CASES.iter().enumerate() {
        let seed = unhex(seed_hex);
        let digest = unhex(digest_hex);

        let sk = derive_bls_sk(&seed, *index);
        let pk = PublicKey::from(&sk);

        let mut signed_message = Vec::with_capacity(SIG_TAG.len() + digest.len());
        signed_message.extend_from_slice(SIG_TAG);
        signed_message.extend_from_slice(&digest);

        let sig = sk.sign(&signed_message);

        println!("  \"{name}\": {{");
        println!("    \"secretKeyLeHex\": \"{}\",", hex(&sk.to_bytes()));
        println!("    \"publicKeyG2Hex\": \"{}\",", hex(&pk.to_bytes()));
        println!("    \"signedMessageHex\": \"{}\",", hex(&signed_message));
        println!("    \"signatureG1Hex\": \"{}\"", hex(&sig.to_bytes()));
        print!("  }}");
        println!("{}", if i + 1 == CASES.len() { "" } else { "," });
    }
    println!("}}");
}
