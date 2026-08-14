# Contributing

Thanks for considering contributing to Corpuslane. Keep this whole project
<big>honest</big>: docs and code should reflect the real trust model. Do not
describe metered licensing as trustless.

## Development setup

See [README.md](README.md#quick-start-local-development) for the full local
setup. Short version:

- **Contract** (`contract/`): Rust + soroban-sdk 27.
  - `cargo test --features testutils` — unit + doc tests.
  - `cargo build-wasm` — release wasm for `wasm32v1-none`.
  - `cargo fmt` before pushing; CI runs `cargo fmt --check`.
- **Backend** (`backend/`): Express + Prisma.
  - `npm run typecheck`, `npm run lint`, `npm run build`, `npm test`.
- **Frontend** (`frontend/`): Next.js 14.
  - `npm run typecheck`, `npm run lint`, `npm run build`.

## Commands cheat-sheet

| Action | Command |
| --- | --- |
| Contract unit tests | `cd contract && cargo test --features testutils` |
| Build contract wasm | `cd contract && cargo build-wasm` |
| Backend typecheck | `cd backend && npm run typecheck` |
| Backend lint | `cd backend && npm run lint` |
| Backend API | `cd backend && npm run dev` |
| Backend indexer | `cd backend && npm run indexer` |
| Frontend dev server | `cd frontend && npm run dev` |
| Full stack (Docker) | `CONTRACT_ID=… docker compose up --build` |

## Code style

- Rust: `cargo fmt`; tests live in `contract/src/contract.rs` under `mod tests`.
- TypeScript: strict mode; no unused vars (`argsIgnorePattern: "^_"`); keep
  API/library imports as already styled.
- No code comments that explain “what” the code does; document *why* when it
  isn&apos;t obvious.
- Secret/allowance values: never commit real ones; `.env*` are gitignored.

## What to work on

- Anything in [SECURITY.md](SECURITY.md#known-issues--hardening-backlog) —
  especially the revoked-license settlement discrepancy.
- **[GOOD-FIRST-ISSUES.md](GOOD-FIRST-ISSUES.md)** — a curated, scoped list
  sized for Drips Wave participation (Trivial/Medium/High). When you file one
  on GitHub, label it `Stellar Wave` and set the complexity in the Drips app.
- An on-chain testnet deployment run (`scripts/deploy-testnet.sh`) and
  documenting the results.
- The docker-compose stack has not been executed in the dev environment; run
  it and fix anything that drifts from these instructions.

## Pull requests

1. Branch off `main`; one logical change per PR.
2. Run the local checks above and fix them.
3. Update [`CHANGELOG.md`](CHANGELOG.md), [`API.md`](API.md), and
   [`DEPLOYMENT.md`](DEPLOYMENT.md) if the change touches them.
4. Be explicit in the PR description about anything you could **not** run
   locally (docker, soroban CLI, live testnet) so reviewers know.

## Questions

Open an issue, or a draft PR with your proposal, before large changes.