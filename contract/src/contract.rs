use soroban_sdk::{contract, contractimpl, token::TokenClient, Address, BytesN, Env};

use crate::events::{
    AttestorSetEvent, DatasetRegisteredEvent, LicensePurchasedEvent, LicenseRevokedEvent,
    LicenseSettledEvent, UsageRecordedEvent,
};
use crate::storage::{
    get_attestor, get_dataset, get_next_license_id, require_dataset, require_license,
    set_next_license_id, store_attestor, store_dataset, store_license,
};
use crate::types::{validate_terms, Dataset, License, LicenseStatus, LicenseTerms};

#[contract]
pub struct Corpuslane;

#[contractimpl]
impl Corpuslane {
    /// Registers a dataset and its license terms.
    ///
    /// `metadata_hash` is a content-address of the off-chain machine-readable
    /// dataset metadata plus a human-readable license description. The license
    /// *text* is never stored on-chain; only its hash is committed so that the
    /// registered terms can be proven to match what was published off-chain.
    ///
    /// Requires authorization from `owner`. Returns the dataset id.
    pub fn register_dataset(
        env: Env,
        owner: Address,
        dataset_id: BytesN<32>,
        metadata_hash: BytesN<32>,
        license_terms: LicenseTerms,
    ) -> BytesN<32> {
        owner.require_auth();

        if get_dataset(&env, &dataset_id).is_some() {
            panic!("Dataset already registered");
        }
        validate_terms(&license_terms);

        let dataset = Dataset {
            owner: owner.clone(),
            dataset_id: dataset_id.clone(),
            metadata_hash,
            license_terms,
            registered_at: env.ledger().timestamp(),
            license_count: 0,
        };
        store_dataset(&env, &dataset);

        DatasetRegisteredEvent {
            dataset_id: dataset_id.clone(),
            owner: owner.clone(),
            metadata_hash: dataset.metadata_hash.clone(),
            license_terms: dataset.license_terms.clone(),
        }
        .publish(&env);

        dataset_id
    }

    /// Purchases a license for `dataset_id`.
    ///
    /// - `Flat`: validates that `payment == price` and pulls the full amount
    ///   from the licensee's token allowance into the owner. The license is
    ///   paid in full at purchase; there is nothing to settle later.
    /// - `PerQuery` / `PerEpoch`: opens a metered account. No upfront payment
    ///   is accepted (`payment` must be 0). Funds are pulled at settlement
    ///   time via the licensee's token allowance.
    ///
    /// The licensee must have approved the Corpuslane contract to spend the
    /// token before calling this (or before settlement).
    pub fn purchase_license(
        env: Env,
        dataset_id: BytesN<32>,
        licensee: Address,
        token: Address,
        payment: i128,
    ) -> u64 {
        licensee.require_auth();

        if payment < 0 {
            panic!("Payment cannot be negative");
        }

        let dataset = require_dataset(&env, &dataset_id);
        let license_id = get_next_license_id(&env);
        set_next_license_id(&env, license_id + 1);

        let purchased_at = env.ledger().timestamp();
        let contract = env.current_contract_address();
        let token_client = TokenClient::new(&env, &token);

        let license = match dataset.license_terms.clone() {
            LicenseTerms::Flat(price) => {
                if payment != price {
                    panic!("Payment does not match the flat price");
                }
                // Pull the one-time fee directly into the owner's wallet.
                token_client.transfer_from(&contract, &licensee, &dataset.owner, &price);
                License {
                    id: license_id,
                    dataset_id: dataset_id.clone(),
                    licensee: licensee.clone(),
                    token: token.clone(),
                    terms: LicenseTerms::Flat(price),
                    status: LicenseStatus::Active,
                    purchased_at,
                    usage_count: 0,
                    payable: 0,
                    settled_total: price,
                    last_settle_timestamp: purchased_at,
                }
            }
            LicenseTerms::PerQuery(price) => {
                if payment != 0 {
                    panic!("PerQuery licenses require no upfront payment");
                }
                License {
                    id: license_id,
                    dataset_id: dataset_id.clone(),
                    licensee: licensee.clone(),
                    token: token.clone(),
                    terms: LicenseTerms::PerQuery(price),
                    status: LicenseStatus::Active,
                    purchased_at,
                    usage_count: 0,
                    payable: 0,
                    settled_total: 0,
                    last_settle_timestamp: purchased_at,
                }
            }
            LicenseTerms::PerEpoch(price, epoch_seconds) => {
                if payment != 0 {
                    panic!("PerEpoch licenses require no upfront payment");
                }
                License {
                    id: license_id,
                    dataset_id: dataset_id.clone(),
                    licensee: licensee.clone(),
                    token: token.clone(),
                    terms: LicenseTerms::PerEpoch(price, epoch_seconds),
                    status: LicenseStatus::Active,
                    purchased_at,
                    usage_count: 0,
                    payable: 0,
                    settled_total: 0,
                    last_settle_timestamp: purchased_at,
                }
            }
        };

        let mut updated_dataset = dataset.clone();
        updated_dataset.license_count += 1;
        store_dataset(&env, &updated_dataset);
        store_license(&env, &license);

        LicensePurchasedEvent {
            license_id,
            dataset_id: dataset_id.clone(),
            licensee: licensee.clone(),
            token: token.clone(),
            license_terms: license.terms.clone(),
        }
        .publish(&env);

        license_id
    }

    /// Designates a delegated usage reporter for a dataset.
    ///
    /// Only the dataset owner may set an attestor. When set, both the
    /// attestor and the licensee are permitted to report usage for PerQuery
    /// licenses. This is the mechanism owners use to move usage metering off
    /// self-reporting (see SECURITY.md).
    pub fn set_attestor(env: Env, dataset_id: BytesN<32>, caller: Address, attestor: Address) {
        caller.require_auth();
        let dataset = require_dataset(&env, &dataset_id);
        if caller != dataset.owner {
            panic!("Only the dataset owner can set an attestor");
        }
        store_attestor(&env, &dataset_id, &attestor);

        AttestorSetEvent {
            dataset_id,
            attestor: attestor.clone(),
        }
        .publish(&env);
    }

    /// Records usage against a PerQuery license.
    ///
    /// Only the licensee or a dataset-delegated attestor may call this. Each
    /// reported unit accrues `price` to the dataset owner's payable balance.
    ///
    /// ## Trust note
    ///
    /// This path is *not* trustless. If a licensee is allowed to self-report,
    /// they can under-report to reduce their bill. An owner who wants
    /// dependable metering should delegate an attestor that measures usage
    /// outside the contract. See SECURITY.md for the honest assessment.
    pub fn record_usage(env: Env, license_id: u64, caller: Address, usage_count: u32) {
        caller.require_auth();

        let mut license = require_license(&env, license_id);
        if license.status != LicenseStatus::Active {
            panic!("License is revoked");
        }

        match license.terms {
            LicenseTerms::PerQuery(price) => {
                let is_licensee = caller == license.licensee;
                let is_attestor = get_attestor(&env, &license.dataset_id)
                    .map_or(false, |attestor| caller == attestor);
                if !is_licensee && !is_attestor {
                    panic!("Only the licensee or a delegated attestor may record usage");
                }

                let delta = (usage_count as i128) * price;
                license.usage_count += usage_count as u64;
                license.payable += delta;
                store_license(&env, &license);

                UsageRecordedEvent {
                    license_id,
                    caller: caller.clone(),
                    usage_count,
                    delta,
                }
                .publish(&env);
            }
            _ => {
                panic!("Usage recording is only supported for PerQuery licenses");
            }
        }
    }

    /// Settles the accrued payable balance of a license.
    ///
    /// Callable by anyone (permissionless trigger). Funds are pulled from the
    /// licensee's token allowance and transferred to the dataset owner only —
    /// the caller never touches them.
    ///
    /// For PerEpoch licenses, this first accrues the epochs that have elapsed
    /// since the previous settlement. Revoked licenses are frozen: no further
    /// epochs accrue, but royalties accrued before revocation remain
    /// collectable here.
    ///
    /// Panics with "No balance to settle" when there is nothing to collect.
    ///
    /// Returns the amount transferred.
    pub fn settle(env: Env, license_id: u64, caller: Address) -> i128 {
        caller.require_auth();

        let mut license = require_license(&env, license_id);

        let dataset = require_dataset(&env, &license.dataset_id);

        // Accrue elapsed epochs for PerEpoch licenses before pulling funds.
        // Revoked licenses no longer accrue: the clock is frozen at revocation.
        if license.status == LicenseStatus::Active {
            if let LicenseTerms::PerEpoch(price, epoch_seconds) = license.terms {
                let now = env.ledger().timestamp();
                let base = license.last_settle_timestamp;
                let elapsed = now.saturating_sub(base);
                let epochs = elapsed / epoch_seconds;
                if epochs > 0 {
                    let accrued = (epochs as i128) * price;
                    license.last_settle_timestamp = base + epochs * epoch_seconds;
                    license.payable += accrued;
                }
            }
        }

        let amount = license.payable;
        if amount <= 0 {
            panic!("No balance to settle");
        }

        // Checks-Effects-Interactions: commit the accounting change before the
        // external token call. The transaction is atomic, so a failed
        // transfer_from still rolls everything back.
        license.payable = 0;
        license.settled_total += amount;
        store_license(&env, &license);

        let contract = env.current_contract_address();
        let token_client = TokenClient::new(&env, &license.token);
        token_client.transfer_from(&contract, &license.licensee, &dataset.owner, &amount);

        LicenseSettledEvent {
            license_id,
            caller: caller.clone(),
            amount,
        }
        .publish(&env);

        amount
    }

    /// Revokes a license owned by `dataset_id`.
    ///
    /// Owner-only. Once revoked, `record_usage` is rejected and no further
    /// royalties accrue (the PerEpoch clock is frozen). Any already-accrued
    /// payable remains claimable by the owner via `settle` — revocation does
    /// not destroy earned royalties.
    pub fn revoke_license(env: Env, dataset_id: BytesN<32>, caller: Address, license_id: u64) {
        caller.require_auth();
        let dataset = require_dataset(&env, &dataset_id);
        if caller != dataset.owner {
            panic!("Only the dataset owner can revoke a license");
        }

        let mut license = require_license(&env, license_id);
        if license.dataset_id != dataset_id {
            panic!("License does not belong to this dataset");
        }
        if license.status == LicenseStatus::Revoked {
            panic!("License already revoked");
        }

        license.status = LicenseStatus::Revoked;
        store_license(&env, &license);

        LicenseRevokedEvent {
            license_id,
            dataset_id,
        }
        .publish(&env);
    }

    // -----------------------------------------------------------------------
    // Read-only views
    // -----------------------------------------------------------------------

    pub fn get_dataset(env: Env, dataset_id: BytesN<32>) -> Dataset {
        require_dataset(&env, &dataset_id)
    }

    pub fn get_license(env: Env, license_id: u64) -> License {
        require_license(&env, license_id)
    }

    pub fn get_attestor(env: Env, dataset_id: BytesN<32>) -> Option<Address> {
        get_attestor(&env, &dataset_id)
    }

    pub fn next_license_id(env: Env) -> u64 {
        get_next_license_id(&env)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Events as _, Ledger as _},
        token::{StellarAssetClient, TokenClient},
        xdr, BytesN,
    };

    struct TestContext {
        env: Env,
        contract: Address,
        owner: Address,
        licensee: Address,
        stranger: Address,
        attestor: Address,
        admin: Address,
        token: Address,
    }

    fn dataset_id(env: &Env, seed: u8) -> BytesN<32> {
        let mut arr = [0u8; 32];
        arr[0] = seed;
        arr[31] = 0x10 + seed;
        BytesN::from_array(env, &arr)
    }

    fn metadata_id(env: &Env, seed: u8) -> BytesN<32> {
        let mut arr = [0xabu8; 32];
        arr[0] = seed.wrapping_add(0x20);
        BytesN::from_array(env, &arr)
    }

    fn setup() -> TestContext {
        let env = Env::default();
        let admin = Address::generate(&env);
        let owner = Address::generate(&env);
        let licensee = Address::generate(&env);
        let stranger = Address::generate(&env);
        let attestor = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let contract = env.register(Corpuslane, ());
        env.mock_all_auths();
        // Non-zero default so that `registered_at` / `purchased_at` stamps
        // produced under the shared fixture are meaningful.
        env.ledger().set_timestamp(1_000_000);
        TestContext {
            env,
            contract,
            owner,
            licensee,
            stranger,
            attestor,
            admin,
            token,
        }
    }

    fn ctx_client(ctx: &TestContext) -> CorpuslaneClient<'_> {
        CorpuslaneClient::new(&ctx.env, &ctx.contract)
    }

    /// Funds an address and approves the Corpuslane contract to move tokens.
    fn fund_and_approve(ctx: &TestContext, who: &Address, amount: i128) {
        let sac = StellarAssetClient::new(&ctx.env, &ctx.token);
        sac.mint(who, &amount);
        TokenClient::new(&ctx.env, &ctx.token).approve(who, &ctx.contract, &amount, &2_000_000);
    }

    fn balance_of(ctx: &TestContext, who: &Address) -> i128 {
        TokenClient::new(&ctx.env, &ctx.token).balance(who)
    }

    fn register_flat(ctx: &TestContext, did: &BytesN<32>, price: i128) {
        let c = ctx_client(ctx);
        c.register_dataset(
            &ctx.owner,
            did,
            &metadata_id(&ctx.env, 1),
            &LicenseTerms::Flat(price),
        );
    }

    // ----------------------------------------------------------------------
    // register_dataset
    // ----------------------------------------------------------------------

    #[test]
    fn test_register_dataset() {
        let ctx = setup();
        let client = ctx_client(&ctx);
        let did = dataset_id(&ctx.env, 1);

        let returned = client.register_dataset(
            &ctx.owner,
            &did,
            &metadata_id(&ctx.env, 2),
            &LicenseTerms::PerQuery(10),
        );

        assert_eq!(returned, did);

        let ds = client.get_dataset(&did);
        assert_eq!(ds.owner, ctx.owner);
        assert_eq!(ds.dataset_id, did);
        assert_eq!(ds.license_terms, LicenseTerms::PerQuery(10));
        assert_eq!(ds.license_count, 0);
        assert!(ds.registered_at > 0);
    }

    #[test]
    #[should_panic(expected = "Dataset already registered")]
    fn test_duplicate_dataset_rejected() {
        let ctx = setup();
        let client = ctx_client(&ctx);
        let did = dataset_id(&ctx.env, 1);
        client.register_dataset(
            &ctx.owner,
            &did,
            &metadata_id(&ctx.env, 2),
            &LicenseTerms::Flat(100),
        );
        client.register_dataset(
            &ctx.owner,
            &did,
            &metadata_id(&ctx.env, 3),
            &LicenseTerms::Flat(100),
        );
    }

    #[test]
    fn test_register_dataset_requires_auth() {
        let env = Env::default();
        // No mock auths: any require_auth will panic.
        let owner = Address::generate(&env);
        let contract = env.register(Corpuslane, ());
        let client = CorpuslaneClient::new(&env, &contract);
        let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.register_dataset(
                &owner,
                &dataset_id(&env, 1),
                &metadata_id(&env, 2),
                &LicenseTerms::Flat(100),
            );
        }));
        assert!(res.is_err(), "register_dataset must require owner auth");
    }

    // ----------------------------------------------------------------------
    // purchase_license — Flat
    // ----------------------------------------------------------------------

    #[test]
    fn test_flat_purchase_valid_payment() {
        let ctx = setup();
        let client = ctx_client(&ctx);
        let did = dataset_id(&ctx.env, 1);
        register_flat(&ctx, &did, 100);
        fund_and_approve(&ctx, &ctx.licensee, 500);

        let license_id = client.purchase_license(&did, &ctx.licensee, &ctx.token, &100);

        assert_eq!(license_id, 1);
        assert_eq!(balance_of(&ctx, &ctx.owner), 100);
        assert_eq!(balance_of(&ctx, &ctx.licensee), 400);

        let lic = client.get_license(&license_id);
        assert_eq!(lic.licensee, ctx.licensee);
        assert_eq!(lic.terms, LicenseTerms::Flat(100));
        assert_eq!(lic.status, LicenseStatus::Active);
        assert_eq!(lic.payable, 0);
        assert_eq!(lic.settled_total, 100);
        // No metering for flat licenses.
        assert_eq!(lic.usage_count, 0);
    }

    #[test]
    #[should_panic(expected = "Payment does not match the flat price")]
    fn test_flat_purchase_wrong_payment() {
        let ctx = setup();
        let client = ctx_client(&ctx);
        let did = dataset_id(&ctx.env, 1);
        register_flat(&ctx, &did, 100);
        fund_and_approve(&ctx, &ctx.licensee, 500);

        client.purchase_license(&did, &ctx.licensee, &ctx.token, &99);
    }

    #[test]
    #[should_panic(expected = "Payment cannot be negative")]
    fn test_flat_purchase_negative_payment() {
        let ctx = setup();
        let client = ctx_client(&ctx);
        let did = dataset_id(&ctx.env, 1);
        register_flat(&ctx, &did, 100);
        client.purchase_license(&did, &ctx.licensee, &ctx.token, &-1);
    }

    #[test]
    #[should_panic(expected = "Dataset not found")]
    fn test_purchase_missing_dataset() {
        let ctx = setup();
        let client = ctx_client(&ctx);
        let did = dataset_id(&ctx.env, 9);
        fund_and_approve(&ctx, &ctx.licensee, 500);
        client.purchase_license(&did, &ctx.licensee, &ctx.token, &100);
    }

    // ----------------------------------------------------------------------
    // purchase_license — metered
    // ----------------------------------------------------------------------

    #[test]
    #[should_panic(expected = "PerQuery licenses require no upfront payment")]
    fn test_per_query_requires_zero_upfront() {
        let ctx = setup();
        let client = ctx_client(&ctx);
        let did = dataset_id(&ctx.env, 1);
        client.register_dataset(
            &ctx.owner,
            &did,
            &metadata_id(&ctx.env, 2),
            &LicenseTerms::PerQuery(5),
        );
        client.purchase_license(&did, &ctx.licensee, &ctx.token, &5);
    }

    #[test]
    #[should_panic(expected = "PerEpoch licenses require no upfront payment")]
    fn test_per_epoch_requires_zero_upfront() {
        let ctx = setup();
        let client = ctx_client(&ctx);
        let did = dataset_id(&ctx.env, 1);
        client.register_dataset(
            &ctx.owner,
            &did,
            &metadata_id(&ctx.env, 2),
            &LicenseTerms::PerEpoch(10, 100),
        );
        client.purchase_license(&did, &ctx.licensee, &ctx.token, &10);
    }

    // ----------------------------------------------------------------------
    // record_usage — PerQuery self-reporting & attestor
    // ----------------------------------------------------------------------

    #[test]
    fn test_record_usage_accrues_payable() {
        let ctx = setup();
        let client = ctx_client(&ctx);
        let did = dataset_id(&ctx.env, 1);
        client.register_dataset(
            &ctx.owner,
            &did,
            &metadata_id(&ctx.env, 2),
            &LicenseTerms::PerQuery(5),
        );
        let license_id = client.purchase_license(&did, &ctx.licensee, &ctx.token, &0);

        client.record_usage(&license_id, &ctx.licensee, &10_u32);
        client.record_usage(&license_id, &ctx.licensee, &4_u32);

        let lic = client.get_license(&license_id);
        assert_eq!(lic.usage_count, 14);
        assert_eq!(lic.payable, 70); // (10 + 4) * 5
    }

    #[test]
    fn test_record_usage_by_delegated_attestor() {
        let ctx = setup();
        let client = ctx_client(&ctx);
        let did = dataset_id(&ctx.env, 1);
        client.register_dataset(
            &ctx.owner,
            &did,
            &metadata_id(&ctx.env, 2),
            &LicenseTerms::PerQuery(5),
        );
        client.set_attestor(&did, &ctx.owner, &ctx.attestor);
        let license_id = client.purchase_license(&did, &ctx.licensee, &ctx.token, &0);

        client.record_usage(&license_id, &ctx.attestor, &7_u32);

        let lic = client.get_license(&license_id);
        assert_eq!(lic.usage_count, 7);
        assert_eq!(lic.payable, 35);

        assert_eq!(client.get_attestor(&did), Some(ctx.attestor.clone()));
    }

    #[test]
    #[should_panic(expected = "Only the dataset owner can set an attestor")]
    fn test_set_attestor_owner_only() {
        let ctx = setup();
        let client = ctx_client(&ctx);
        let did = dataset_id(&ctx.env, 1);
        client.register_dataset(
            &ctx.owner,
            &did,
            &metadata_id(&ctx.env, 2),
            &LicenseTerms::PerQuery(5),
        );
        client.set_attestor(&did, &ctx.stranger, &ctx.attestor);
    }

    #[test]
    #[should_panic(expected = "Only the licensee or a delegated attestor may record usage")]
    fn test_record_usage_unauthorized() {
        let ctx = setup();
        let client = ctx_client(&ctx);
        let did = dataset_id(&ctx.env, 1);
        client.register_dataset(
            &ctx.owner,
            &did,
            &metadata_id(&ctx.env, 2),
            &LicenseTerms::PerQuery(5),
        );
        let license_id = client.purchase_license(&did, &ctx.licensee, &ctx.token, &0);
        client.record_usage(&license_id, &ctx.stranger, &1_u32);
    }

    #[test]
    #[should_panic(expected = "Usage recording is only supported for PerQuery licenses")]
    fn test_record_usage_rejected_for_flat() {
        let ctx = setup();
        let client = ctx_client(&ctx);
        let did = dataset_id(&ctx.env, 1);
        register_flat(&ctx, &did, 100);
        fund_and_approve(&ctx, &ctx.licensee, 500);
        let license_id = client.purchase_license(&did, &ctx.licensee, &ctx.token, &100);
        client.record_usage(&license_id, &ctx.licensee, &1_u32);
    }

    // ----------------------------------------------------------------------
    // settle — partial payment history (PerQuery)
    // ----------------------------------------------------------------------

    #[test]
    fn test_settle_partial_payment_history() {
        let ctx = setup();
        let client = ctx_client(&ctx);
        let did = dataset_id(&ctx.env, 1);
        client.register_dataset(
            &ctx.owner,
            &did,
            &metadata_id(&ctx.env, 2),
            &LicenseTerms::PerQuery(5),
        );
        fund_and_approve(&ctx, &ctx.licensee, 1000);
        let license_id = client.purchase_license(&did, &ctx.licensee, &ctx.token, &0);

        // First usage window.
        client.record_usage(&license_id, &ctx.licensee, &10_u32);
        let settled1 = client.settle(&license_id, &ctx.stranger);
        assert_eq!(settled1, 50);
        assert_eq!(balance_of(&ctx, &ctx.owner), 50);

        let lic = client.get_license(&license_id);
        assert_eq!(lic.payable, 0);
        assert_eq!(lic.settled_total, 50);

        // Second usage window, partial.
        client.record_usage(&license_id, &ctx.licensee, &6);
        let settled2 = client.settle(&license_id, &ctx.stranger);
        assert_eq!(settled2, 30);
        assert_eq!(balance_of(&ctx, &ctx.owner), 80);

        let lic = client.get_license(&license_id);
        assert_eq!(lic.payable, 0);
        assert_eq!(lic.settled_total, 80);
        assert_eq!(lic.usage_count, 16);

        // Settling with nothing owed is rejected.
        let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.settle(&license_id, &ctx.stranger);
        }));
        assert!(res.is_err(), "settle with no balance must panic");
    }

    #[test]
    fn test_flat_has_nothing_to_settle() {
        let ctx = setup();
        let client = ctx_client(&ctx);
        let did = dataset_id(&ctx.env, 1);
        register_flat(&ctx, &did, 100);
        fund_and_approve(&ctx, &ctx.licensee, 500);
        let license_id = client.purchase_license(&did, &ctx.licensee, &ctx.token, &100);
        let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.settle(&license_id, &ctx.stranger);
        }));
        assert!(res.is_err(), "flat licenses must have nothing to settle");
    }

    // ----------------------------------------------------------------------
    // settle — PerEpoch accrual over simulated time
    // ----------------------------------------------------------------------

    #[test]
    fn test_per_epoch_accrual_over_time() {
        let ctx = setup();
        let client = ctx_client(&ctx);
        let did = dataset_id(&ctx.env, 1);
        client.register_dataset(
            &ctx.owner,
            &did,
            &metadata_id(&ctx.env, 2),
            &LicenseTerms::PerEpoch(10, 100),
        );
        fund_and_approve(&ctx, &ctx.licensee, 100_000);

        let t0 = 1_000_000u64;
        ctx.env.ledger().set_timestamp(t0);
        let license_id = client.purchase_license(&did, &ctx.licensee, &ctx.token, &0);

        // Partial epoch: nothing has accrued yet.
        ctx.env.ledger().set_timestamp(t0 + 50);
        let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.settle(&license_id, &ctx.stranger);
        }));
        assert!(res.is_err(), "partial epoch must not accrue");

        // 1 full epoch elapsed (150s) -> 1 * 10.
        ctx.env.ledger().set_timestamp(t0 + 150);
        let settled1 = client.settle(&license_id, &ctx.stranger);
        assert_eq!(settled1, 10);
        assert_eq!(balance_of(&ctx, &ctx.owner), 10);

        // 110s after boundary (t0+100): 1 more epoch.
        ctx.env.ledger().set_timestamp(t0 + 260);
        let settled2 = client.settle(&license_id, &ctx.stranger);
        assert_eq!(settled2, 10);
        assert_eq!(balance_of(&ctx, &ctx.owner), 20);

        // Exactly one boundary: 2 full epochs (200s) -> 2 * 10, no double count.
        ctx.env.ledger().set_timestamp(t0 + 460);
        let settled3 = client.settle(&license_id, &ctx.stranger);
        assert_eq!(settled3, 20);
        assert_eq!(balance_of(&ctx, &ctx.owner), 40);

        let lic = client.get_license(&license_id);
        assert_eq!(lic.payable, 0);
        assert_eq!(lic.settled_total, 40);
    }

    // ----------------------------------------------------------------------
    // revoke_license
    // ----------------------------------------------------------------------

    #[test]
    fn test_revoked_license_rejects_usage() {
        let ctx = setup();
        let client = ctx_client(&ctx);
        let did = dataset_id(&ctx.env, 1);
        client.register_dataset(
            &ctx.owner,
            &did,
            &metadata_id(&ctx.env, 2),
            &LicenseTerms::PerQuery(5),
        );
        fund_and_approve(&ctx, &ctx.licensee, 1000);
        let license_id = client.purchase_license(&did, &ctx.licensee, &ctx.token, &0);

        client.revoke_license(&did, &ctx.owner, &license_id);

        let lic = client.get_license(&license_id);
        assert_eq!(lic.status, LicenseStatus::Revoked);

        // record_usage must be rejected on a revoked license.
        let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.record_usage(&license_id, &ctx.licensee, &1_u32);
        }));
        assert!(res.is_err());
    }

    #[test]
    fn test_revoked_license_settles_accrued_payable() {
        let ctx = setup();
        let client = ctx_client(&ctx);
        let did = dataset_id(&ctx.env, 1);
        client.register_dataset(
            &ctx.owner,
            &did,
            &metadata_id(&ctx.env, 2),
            &LicenseTerms::PerQuery(5),
        );
        fund_and_approve(&ctx, &ctx.licensee, 1000);
        let license_id = client.purchase_license(&did, &ctx.licensee, &ctx.token, &0);

        client.record_usage(&license_id, &ctx.licensee, &3_u32);
        client.revoke_license(&did, &ctx.owner, &license_id);

        // Royalties accrued before revocation remain collectable by the owner.
        let settled = client.settle(&license_id, &ctx.stranger);
        assert_eq!(settled, 15);
        assert_eq!(balance_of(&ctx, &ctx.owner), 15);

        let lic = client.get_license(&license_id);
        assert_eq!(lic.status, LicenseStatus::Revoked);
        assert_eq!(lic.payable, 0);
        assert_eq!(lic.settled_total, 15);

        // Nothing left to settle.
        let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.settle(&license_id, &ctx.stranger);
        }));
        assert!(res.is_err());
    }

    #[test]
    fn test_revoked_per_epoch_does_not_accrue_after_revocation() {
        let ctx = setup();
        let client = ctx_client(&ctx);
        let did = dataset_id(&ctx.env, 1);
        client.register_dataset(
            &ctx.owner,
            &did,
            &metadata_id(&ctx.env, 2),
            &LicenseTerms::PerEpoch(10, 100),
        );
        fund_and_approve(&ctx, &ctx.licensee, 100_000);

        let t0 = 1_000_000u64;
        ctx.env.ledger().set_timestamp(t0);
        let license_id = client.purchase_license(&did, &ctx.licensee, &ctx.token, &0);

        // One epoch elapses and is settled before revocation.
        ctx.env.ledger().set_timestamp(t0 + 150);
        let settled = client.settle(&license_id, &ctx.stranger);
        assert_eq!(settled, 10);
        assert_eq!(balance_of(&ctx, &ctx.owner), 10);

        client.revoke_license(&did, &ctx.owner, &license_id);

        // Time advances well past more epoch boundaries, but the clock is
        // frozen at revocation: settle must not accrue anything further.
        ctx.env.ledger().set_timestamp(t0 + 1000);
        let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.settle(&license_id, &ctx.stranger);
        }));
        assert!(res.is_err(), "revoked PerEpoch license must not accrue");
        assert_eq!(balance_of(&ctx, &ctx.owner), 10);
    }

    #[test]
    #[should_panic(expected = "Only the dataset owner can revoke a license")]
    fn test_revoke_owner_only() {
        let ctx = setup();
        let client = ctx_client(&ctx);
        let did = dataset_id(&ctx.env, 1);
        client.register_dataset(
            &ctx.owner,
            &did,
            &metadata_id(&ctx.env, 2),
            &LicenseTerms::Flat(100),
        );
        client.revoke_license(&did, &ctx.stranger, &1);
    }

    #[test]
    #[should_panic(expected = "License does not belong to this dataset")]
    fn test_revoke_wrong_dataset() {
        let ctx = setup();
        let client = ctx_client(&ctx);
        let did = dataset_id(&ctx.env, 1);
        client.register_dataset(
            &ctx.owner,
            &did,
            &metadata_id(&ctx.env, 2),
            &LicenseTerms::Flat(100),
        );
        fund_and_approve(&ctx, &ctx.licensee, 500);
        let license_id = client.purchase_license(&did, &ctx.licensee, &ctx.token, &100);
        // A second, unrelated dataset must exist so the ownership check is
        // actually reached; revoking a license against the wrong dataset fails.
        let other = dataset_id(&ctx.env, 2);
        client.register_dataset(
            &ctx.owner,
            &other,
            &metadata_id(&ctx.env, 3),
            &LicenseTerms::Flat(100),
        );
        client.revoke_license(&other, &ctx.owner, &license_id);
    }

    // ----------------------------------------------------------------------
    // events
    // ----------------------------------------------------------------------

    /// Collects the Corpuslane event names in the host's event log, in
    /// chronological order. Each top-level test invocation is its own external
    /// batch, so `Events::all()` only surfaces the current batch; the host log
    /// keeps every batch, and we filter out events from other contracts (e.g.
    /// the token contract's `transfer` / `approve`).
    fn corpuslane_event_names(ctx: &TestContext) -> std::vec::Vec<String> {
        let events = ctx.env.host().get_contract_events().unwrap();
        events
            .0
            .iter()
            .filter_map(|he| match &he.event.body {
                xdr::ContractEventBody::V0(v) => match &v.topics.first() {
                    Some(xdr::ScVal::Symbol(sym)) => {
                        let name = String::from_utf8_lossy(&sym.0.to_vec()).into_owned();
                        matches!(
                            name.as_str(),
                            "DatasetRegistered"
                                | "LicensePurchased"
                                | "UsageRecorded"
                                | "LicenseSettled"
                                | "LicenseRevoked"
                                | "AttestorSet"
                        )
                        .then_some(name)
                    }
                    _ => None,
                },
            })
            .collect()
    }

    fn assert_event_names(ctx: &TestContext, expected: &[&str]) {
        let actual = corpuslane_event_names(ctx);
        let expected: std::vec::Vec<String> = expected.iter().map(|s| s.to_string()).collect();
        assert_eq!(actual, expected);
    }

    #[test]
    fn test_events_are_published() {
        let ctx = setup();
        let client = ctx_client(&ctx);
        let did = dataset_id(&ctx.env, 1);

        client.register_dataset(
            &ctx.owner,
            &did,
            &metadata_id(&ctx.env, 2),
            &LicenseTerms::PerQuery(5),
        );
        assert_event_names(&ctx, &["DatasetRegistered"]);

        fund_and_approve(&ctx, &ctx.licensee, 1000);
        let license_id = client.purchase_license(&did, &ctx.licensee, &ctx.token, &0);
        assert_event_names(&ctx, &["LicensePurchased"]);

        client.record_usage(&license_id, &ctx.licensee, &3_u32);
        assert_event_names(&ctx, &["UsageRecorded"]);

        client.settle(&license_id, &ctx.stranger);
        assert_event_names(&ctx, &["LicenseSettled"]);

        client.revoke_license(&did, &ctx.owner, &license_id);
        assert_event_names(&ctx, &["LicenseRevoked"]);
    }
}
