# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-14

Initial release.

### Added
- **Contract** (`contract/`):
  - `register_dataset`, `purchase_license`, `record_usage`, `settle`,
    `revoke_license`, `set_attestor`, and read views.
  - License terms: `Flat`, `PerQuery`, `PerEpoch(price, epoch_seconds)`.
  - Distinct enum storage keys (`DatasetKey`, `LicenseKey`, `AttestorKey`)
    so dataset and license ids cannot collide in ledger storage.
  - Events: `DatasetRegistered`, `LicensePurchased`, `UsageRecorded`,
    `LicenseSettled`, `LicenseRevoked`, `AttestorSet`.
  - 21 unit tests + doc tests (`cargo test --features testutils`).
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