use soroban_sdk::{contracttype, Address, BytesN};

/// The commercial terms attached to a dataset at registration time.
///
/// `metadata_hash` on a `Dataset` points off-chain to a human-readable
/// license description; the pricing structure below is the only part of the
/// license that is machine-enforced by this contract.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum LicenseTerms {
    /// A fixed one-time payment. The full `price` is transferred to the owner
    /// at purchase time. No usage metering.
    Flat(i128),
    /// Pay-per-query. Each reported unit of usage accrues `price` to the
    /// dataset owner. Metering depends on honest reporting — see SECURITY.md.
    PerQuery(i128),
    /// Subscription metered by wall-clock epochs: `(price, epoch_seconds)`.
    /// Each `epoch_seconds` of elapsed time accrues `price` to the owner.
    PerEpoch(i128, u64),
}

/// Lifecycle state of a license.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum LicenseStatus {
    /// Usage may be recorded and settled.
    Active,
    /// Set by the dataset owner when the terms are violated (e.g. detected
    /// redistribution). All further `record_usage` / `settle` calls are
    /// rejected.
    Revoked,
}

/// A registered dataset.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Dataset {
    pub owner: Address,
    pub dataset_id: BytesN<32>,
    /// Content-address of the off-chain machine-readable metadata and the
    /// human-readable license document. Never stored on-chain.
    pub metadata_hash: BytesN<32>,
    pub license_terms: LicenseTerms,
    pub registered_at: u64,
    pub license_count: u64,
}

/// A purchased license.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct License {
    pub id: u64,
    pub dataset_id: BytesN<32>,
    pub licensee: Address,
    /// The SEP-41 token used for payments under this license. Chosen by the
    /// licensee at purchase time.
    pub token: Address,
    pub terms: LicenseTerms,
    pub status: LicenseStatus,
    pub purchased_at: u64,
    /// Total units of usage reported (PerQuery).
    pub usage_count: u64,
    /// Accrued but not yet settled. For PerQuery this grows on
    /// `record_usage`; for PerEpoch this grows as epochs elapse.
    pub payable: i128,
    /// Cumulative amount successfully transferred to the owner.
    pub settled_total: i128,
    /// Boundary of the last settlement epoch accrual (PerEpoch). 0 before the
    /// first settle, otherwise tracks the timestamp up to which epochs have
    /// been accrued.
    pub last_settle_timestamp: u64,
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DatasetKey {
    Dataset(BytesN<32>),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum LicenseKey {
    License(u64),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AttestorKey {
    Attestor(BytesN<32>),
}

/// Validates that a set of license terms is commercially sane.
pub fn validate_terms(terms: &LicenseTerms) {
    match terms {
        LicenseTerms::Flat(price) | LicenseTerms::PerQuery(price) => {
            if *price <= 0 {
                panic!("Price must be greater than zero");
            }
        }
        LicenseTerms::PerEpoch(price, epoch_seconds) => {
            if *price <= 0 {
                panic!("Price must be greater than zero");
            }
            if *epoch_seconds == 0 {
                panic!("Epoch length must be greater than zero");
            }
        }
    }
}
