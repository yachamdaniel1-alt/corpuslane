use soroban_sdk::{contractevent, Address, BytesN};

use crate::types::LicenseTerms;

/// Emitted when a dataset is registered.
#[contractevent(topics = ["DatasetRegistered"], data_format = "vec")]
pub struct DatasetRegisteredEvent {
    #[topic]
    pub dataset_id: BytesN<32>,
    #[topic]
    pub owner: Address,
    pub metadata_hash: BytesN<32>,
    pub license_terms: LicenseTerms,
}

/// Emitted when a license is purchased.
#[contractevent(topics = ["LicensePurchased"], data_format = "vec")]
pub struct LicensePurchasedEvent {
    #[topic]
    pub license_id: u64,
    #[topic]
    pub dataset_id: BytesN<32>,
    #[topic]
    pub licensee: Address,
    pub token: Address,
    pub license_terms: LicenseTerms,
}

/// Emitted when usage is reported against a PerQuery license.
#[contractevent(topics = ["UsageRecorded"], data_format = "vec")]
pub struct UsageRecordedEvent {
    #[topic]
    pub license_id: u64,
    #[topic]
    pub caller: Address,
    pub usage_count: u32,
    pub delta: i128,
}

/// Emitted when a license's accrued balance is settled.
#[contractevent(topics = ["LicenseSettled"], data_format = "vec")]
pub struct LicenseSettledEvent {
    #[topic]
    pub license_id: u64,
    #[topic]
    pub caller: Address,
    pub amount: i128,
}

/// Emitted when a license is revoked by the dataset owner.
#[contractevent(topics = ["LicenseRevoked"], data_format = "vec")]
pub struct LicenseRevokedEvent {
    #[topic]
    pub license_id: u64,
    #[topic]
    pub dataset_id: BytesN<32>,
}

/// Emitted when the dataset owner designates a delegated usage attestor.
#[contractevent(topics = ["AttestorSet"], data_format = "vec")]
pub struct AttestorSetEvent {
    #[topic]
    pub dataset_id: BytesN<32>,
    #[topic]
    pub attestor: Address,
}
