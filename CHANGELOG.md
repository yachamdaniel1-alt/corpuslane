# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-14

Initial release.

### Fixed (post-release hardening)
- **T1 — revoked-license settlement**: `settle` no longer panics on revoked
  licenses. Royalties accrued before revocation remain collectable by the
  owner, and the PerEpoch clock is frozen at revocation so nothing further
  accrues. `record_usage` still rejects revoked licenses. Updated the
  `settle`/`revoke_license` docstrings, README, and SECURITY.md (the
  "revoked-license settlement discrepancy" known issue is resolved).
- **T2 — backend smoke tests**: added an in-memory test store + supertest
  suite (`backend/src/__tests__/api.test.ts`) covering `/health`,
  `/api/datasets` pagination/filtering/404, and `/api/licenses/:id` 400/404.
  `npm test` now enforces real tests (no more `--passWithNoTests`).
- **Live testnet deployment + indexer hardening**: the contract was deployed
  to Soroban testnet and exercised end-to-end (dataset → license → usage →
  settle). Running the indexer against the live network surfaced three latent
  bugs, now fixed: (1) `startLedger: 0` is outside the RPC retention window
  — a fresh indexer now starts behind the tip; (2) stellar-sdk v12 events
  expose their paging token via `event.id`, not `pagingToken`, so the cursor
  was never advancing and events re-applied every poll — this duplicated
  usage/settlement records; (3) `parseTerms` expected the object form of the
  `LicenseTerms` enum but `scValToNative` yields `[Variant, fields...]`.
  `UsageRecord`/`Settlement` now carry a unique `eventId` so re-indexing is
  idempotent. `scripts/deploy-testnet.sh` was updated to the `stellar` CLI.
- **H1 — property tests**: added a deterministic randomized harness
  (`prop_per_query_accounting_invariants_randomized`, 500 steps) asserting
  `settled_total + payable == total_earned`, `payable <= usage_count * price`,
  and non-negative accounting; `prop_flat_license_never_accrues`; and
  `prop_per_epoch_settled_total_is_monotonic` including the revocation freeze.
  26 contract tests now pass.

### Added
- **Contract** (`contract/`):
  - `register_dataset`, `purchase_license`, `record_usage`, `settle`,
    `revoke_license`, `set_attestor`, and read views.
  - License terms: `Flat`, `PerQuery`, `PerEpoch(price, epoch_seconds)`.
  - Distinct enum storage keys (`DatasetKey`, `LicenseKey`, `AttestorKey`)
    so dataset and license ids cannot collide in ledger storage.
  - Events: `DatasetRegistered`, `LicensePurchased`, `UsageRecorded`,
    `LicenseSettled`, `LicenseRevoked`, `AttestorSet`.
  - 26 unit tests + doc tests (`cargo test --features testutils`).
  - Pinned `soroban-sdk = 27.0.6`; wasm build alias for `wasm32v1-none`.
- **Backend** (`backend/`):
  - Read-only Express API: `GET /health`, `GET /api/datasets`,
    `GET /api/datasets/:id`, `GET /api/datasets/:id/licenses`,
    `GET /api/licenses/:id`.
  - Prisma (PostgreSQL) schema mirroring contract entities + generic `Event`
    table for attestor events.
  - Polling event indexer (idempotent by tx hash/ledger seq).
  - Config via `.env` (`.env.example` provided).
- **Frontend** (`frontend/`):
  - Owner dashboard: register datasets, view royalties, revoke licenses.
  - Licensee dashboard: browse/purchase licenses, report usage, settle.
  - Freighter signing via `@stellar/freighter-api` + `@stellar/stellar-sdk`
    v12 (simulate → assemble → sign → submit → poll).
- **DevOps**:
  - `docker/Dockerfile.backend`, `docker/Dockerfile.frontend`,
    `docker-compose.yml` (Postgres + indexer + API + web).
  - GitHub Actions CI for contract / backend / frontend.
  - `scripts/deploy-testnet.sh` (contract deployment helper).
  - `.gitignore` for build artifacts, deps, and secrets.
- **Docs**: README, ARCHITECTURE, SECURITY (explicit about the
  self-reported-usage trust limit), API, DEPLOYMENT, CONTRIBUTING, LICENSE.

### Notes
- `docker compose` and the `soroban` CLI were not run in the development
  environment; those artifacts are written but unverified end-to-end here.
- Metered (PerQuery) usage is self-reported unless an attestor is delegated;
  see SECURITY.md.