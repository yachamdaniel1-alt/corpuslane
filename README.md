# Corpuslane

[![CI](https://github.com/yachamdaniel1-alt/corpuslane/actions/workflows/ci.yml/badge.svg)](https://github.com/yachamdaniel1-alt/corpuslane/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

On-chain licensing and usage-metered royalties for AI training datasets, built
on **Stellar Soroban**.

Corpuslane lets a dataset owner register a dataset on-chain with a
content-addressed metadata hash and immutable licensing terms, then issue
licenses that are either paid **flat** (upfront) or **metered** (per query /
per training epoch). Royalties are settled on-chain in any Soroban token.

> **Read this before trusting it.** Metered licensing depends on *who reports
> usage*. If a licensee self-reports, they can under-report. Corpuslane is not
> a trustless usage oracle — see [SECURITY.md](SECURITY.md) for the honest
> assessment and the attestor mechanism that mitigates it.

## Repository layout

| Directory | What it is |
| --- | --- |
| `contract/` | Soroban smart contract (Rust, soroban-sdk 27). Defines datasets, licenses, usage accounting, settlement, revocation. |
| `backend/` | Read-only Express + Prisma (PostgreSQL) API, plus an event indexer that watches the contract and mirrors state. |
| `frontend/` | Next.js 14 dashboards (owner + licensee) that talk to the contract via Freighter and to the backend API. |
| `docker/`, `docker-compose.yml` | Containerized stack: Postgres, indexer, API, web. |
| `scripts/` | Deploy helpers. |
| `.github/workflows/ci.yml` | CI for contract / backend / frontend. |

## Quick start (local development)

Prerequisites: Node 20+, `psql` or Docker, Rust 1.84+ (for the contract),
and the [Freighter](https://freighter.app) wallet extension.

### 1. Contract

```bash
cd contract
cargo test --features testutils    # 23 unit tests + doc tests
cargo build-wasm                  # target/wasm32v1-none/release/corpuslane.wasm
```

The Rust version must support the `wasm32v1-none` target (Rust 1.84+). See
[ARCHITECTURE.md](ARCHITECTURE.md) for the contract design.

### 2. Backend (API + indexer)

```bash
cd backend
cp .env.example .env              # set DATABASE_URL, CONTRACT_ID
createdb corpuslane               # or point DATABASE_URL elsewhere
npm install
npm run db:push                   # apply Prisma schema
npm run dev                       # API on :3001
npm run indexer                   # event indexer (separate terminal)
```

### 3. Frontend

```bash
cd frontend
cp .env.example .env.local        # set NEXT_PUBLIC_CONTRACT_ID
npm install
npm run dev                       # http://localhost:3000
```

To actually transact you need a **deployed contract** and a funded testnet
account. See [DEPLOYMENT.md](DEPLOYMENT.md).

## What works on-chain

- **Register a dataset** with licensing terms — `Flat(price)`,
  `PerQuery(price)`, or `PerEpoch(price, epoch_seconds)`.
- **Purchase a license** — flat fees are pulled immediately to the owner;
  metered licenses open an account with no upfront payment.
- **Record usage** (PerQuery) — accrued at `price` per unit.
- **Settle** — per-epoch licenses accrue elapsed epochs first, then the owed
  balance is pulled from the licensee&apos;s token allowance to the owner.
- **Revoke** — owner-only; stops further usage and freezes the PerEpoch clock,
  while royalties already accrued remain collectable via `settle`.
- **Delegate an attestor** — the dataset owner can name a trusted reporter
  allowed to record usage, moving metering off pure self-reporting.

## Live on testnet

The contract is deployed and exercised on Soroban testnet:

- **Contract**: `CAUFA5YVBHOVKEJNLCDY6NLXPOM22ANGTE6PFNMSAHM7LFA2UIIB7BUS`
  ([explorer](https://stellar.expert/explorer/testnet/contract/CAUFA5YVBHOVKEJNLCDY6NLXPOM22ANGTE6PFNMSAHM7LFA2UIIB7BUS))
- **Verified flow**: dataset registered → license purchased → usage recorded →
  settled, with the indexer mirroring every event into the backend and the API
  serving it (`/api/datasets`, `/api/licenses/:id`).
- The `stellar` CLI (v27.1.0) was used for the deploy and contract calls; see
  [DEPLOYMENT.md](DEPLOYMENT.md) for the exact, validated commands.

## Limitations (be honest with yourself)

- The backend **indexer is read-only**: it mirrors on-chain state, it never
  writes to the contract. It is an off-chain convenience, not part of the
  trust model.
- `docker`/`docker-compose` and `scripts/deploy-testnet.sh` were **not
  executed** in the development environment where this repository was built.
  The compose stack is written but untested; the deploy script was validated
  against testnet using the `stellar` CLI directly. Everything else has been
  compiled, linted, type-checked, and tested locally, and the contract +
  indexer + API were run against a live testnet deployment.
- See [SECURITY.md](SECURITY.md) for the trust model and its limits.

## Docs

- [GOOD-FIRST-ISSUES.md](GOOD-FIRST-ISSUES.md) — scoped starter tasks (sized for Drips Wave)
- [ARCHITECTURE.md](ARCHITECTURE.md) — system design and data flow
- [SECURITY.md](SECURITY.md) — trust model, threat model, honest limits
- [API.md](API.md) — backend REST endpoints and types
- [DEPLOYMENT.md](DEPLOYMENT.md) — deploy the contract, backend, and frontend
- [CONTRIBUTING.md](CONTRIBUTING.md) — development workflow and commands

## License

MIT — see [LICENSE](LICENSE).
