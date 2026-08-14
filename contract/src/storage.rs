use soroban_sdk::{symbol_short, Address, BytesN, Env, Symbol};

use crate::types::{AttestorKey, Dataset, DatasetKey, License, LicenseKey};

pub const NEXT_LICENSE_ID: Symbol = symbol_short!("next_id");

/// Soroban ledger entries carry a time-to-live (TTL) under the state-expiration
/// / rent model: once it drops to zero the entry is archived and reads fail.
/// Refreshing the TTL on every write keeps long-lived datasets and licenses
/// from expiring while the contract is in use. Extending toward this ledger
/// count on each write is the "pay rent on writes" pattern recommended for
/// frequently-accessed persistent entries (see DEPLOYMENT.md / SECURITY.md).
const TTL_EXTEND_TO: u32 = 1_000_000;

// ---------------------------------------------------------------------------
// Datasets
// ---------------------------------------------------------------------------

pub fn store_dataset(env: &Env, dataset: &Dataset) {
    let key = DatasetKey::Dataset(dataset.dataset_id.clone());
    env.storage().persistent().set(&key, dataset);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_EXTEND_TO, TTL_EXTEND_TO);
}

pub fn get_dataset(env: &Env, dataset_id: &BytesN<32>) -> Option<Dataset> {
    let key = DatasetKey::Dataset(dataset_id.clone());
    env.storage().persistent().get(&key)
}

pub fn require_dataset(env: &Env, dataset_id: &BytesN<32>) -> Dataset {
    get_dataset(env, dataset_id).expect("Dataset not found")
}

// ---------------------------------------------------------------------------
// Licenses
// ---------------------------------------------------------------------------

pub fn store_license(env: &Env, license: &License) {
    let key = LicenseKey::License(license.id);
    env.storage().persistent().set(&key, license);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_EXTEND_TO, TTL_EXTEND_TO);
}

pub fn get_license(env: &Env, license_id: u64) -> Option<License> {
    let key = LicenseKey::License(license_id);
    env.storage().persistent().get(&key)
}

pub fn require_license(env: &Env, license_id: u64) -> License {
    get_license(env, license_id).expect("License not found")
}

pub fn get_next_license_id(env: &Env) -> u64 {
    env.storage().instance().get(&NEXT_LICENSE_ID).unwrap_or(1)
}

pub fn set_next_license_id(env: &Env, next: u64) {
    env.storage().instance().set(&NEXT_LICENSE_ID, &next);
}

// ---------------------------------------------------------------------------
// Attestors (optional delegated usage reporters)
// ---------------------------------------------------------------------------

pub fn store_attestor(env: &Env, dataset_id: &BytesN<32>, attestor: &Address) {
    let key = AttestorKey::Attestor(dataset_id.clone());
    env.storage().persistent().set(&key, attestor);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_EXTEND_TO, TTL_EXTEND_TO);
}

pub fn get_attestor(env: &Env, dataset_id: &BytesN<32>) -> Option<Address> {
    let key = AttestorKey::Attestor(dataset_id.clone());
    env.storage().persistent().get(&key)
}
