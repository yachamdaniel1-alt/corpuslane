# Good first issues

This list is the corpus of issues this repository proposes for Drips Wave
programs (e.g. the Stellar Wave). Each item is scoped, testable, and sized
with the Wave complexity levels from
[docs.drips.network/wave/maintainers/participating-in-a-wave](https://docs.drips.network/wave/maintainers/participating-in-a-wave).

When filing these on GitHub, add the `Stellar Wave` label and set the
complexity in the Drips app so contributors earn the right points.

Work all of them against a checkout that passes the project checks:

```bash
cd contract && cargo test --features testutils && cargo fmt --all -- --check && cargo build-wasm
cd backend  && npm run typecheck && npm run lint && npm run build && npm test
cd frontend && npm run typecheck && npm run lint && npm run build
```

---

## Trivial (100 points)

### ~~T1 — Align `revoke_license` settlement documentation with behavior~~ ✅ resolved

`revoke_license` (contract/src/contract.rs) says "any already-accrued payable
remains claimable by the owner via settle", but `settle` rejects revoked
licenses (`license.status != Active` panics). Decide the intended behavior,
then make the code and the docstring agree:

- **Either** allow `settle` on revoked, still-unpaid licenses (recommended —
  owners should be able to collect royalties earned before revocation), **or**
  explicitly document that revocation forfeits unpaid accrued royalties.
- Update the `revoke_license` doc comment, `settle`'s status check if needed,
  and the matching expectations in the unit tests.
- Keep `SECURITY.md` (Known issues #1) consistent with whatever you change.

Acceptance: `cargo test --features testutils` passes and SECURITY.md no longer
lists "Revoked-license settlement discrepancy".

> **Status**: Done. `settle` accepts revoked licenses and settles their accrued
> payable; the PerEpoch clock is frozen at revocation. Tests, README, and
> SECURITY.md updated (26 contract tests pass). Keep this issue closed.

### ~~T2 — Add a backend API smoke test~~ ✅ resolved

The backend currently has no tests (`npm test` passes via
`--passWithNoTests`). Add a jest test that boots the Express app against an
in-memory Prisma store and asserts:

- `GET /health` returns `200` with `status: "ok"`.
- `GET /api/datasets` returns paginated shape `{ datasets, pagination }`.
- `GET /api/datasets/:id` returns `404` for an unknown dataset id.
- `GET /api/licenses/:id` returns `400` for a non-positive integer id.

Follow the existing `ts-jest` config in `backend/jest.config.js`.

Acceptance: `cd backend && npm test` runs real tests that pass.

> **Status**: Done. `backend/src/__tests__/api.test.ts` boots the real Express
> app against an in-memory store (supertest); 10 tests pass and `npm test` no
> longer uses `--passWithNoTests`. Keep this issue closed.

## Medium (150 points)

### M1 — Configurable CORS for the backend API

The API has no CORS middleware. Add a `cors` package dependency and a
`CORS_ALLOWED_ORIGIN` env var (comma-separated origins; empty = same-origin
only). Document it in `backend/.env.example` and `DEPLOYMENT.md`.

Acceptance: request with `Origin: https://app.example.com` is allowed only when
that origin is in `CORS_ALLOWED_ORIGIN`; preflight `OPTIONS` works; lint +
typecheck + build pass.

### M2 — Keeper script to keep the contract alive (ledger TTL)

Soroban entries expire (rent/TTL). The contract self-extends TTLs on writes,
but the contract instance, WASM, and infrequently-written entries still need a
keep-alive. Write `scripts/extend-ttl.sh` that takes
`SOROBAN_RPC_URL`, `CONTRACT_ID`, and `CONTACT_ACCOUNT` (or secret) and issues
`stellar contract extend` for the instance + WASM with a generous
`--ledgers-to-extend`, plus logs which ledgers it refreshed. Make it idempotent
and cron-safe (exit 0 quickly when TTL is already above threshold). Document
usage in DEPLOYMENT.md (the keep-alive section).

Acceptance: shellcheck-clean `bash -n`; documented; the script runs without
errors against testnet when the `stellar`/`soroban` CLI is available.

### M3 — Curated SEP-41 token quick-picks in the licensee dashboard

`frontend/src/lib/contract.ts` already derives SAC addresses from `XLM` or
`CODE:ISSUER`. Extend the licensee purchase flow so common testnet assets
(e.g. native XLM and testnet USDC/EURC) are offered as labelled quick-pick
buttons with their **correct** SAC addresses, while still allowing a pasted
`C…` id or `CODE:ISSUER`. Verify each listed address against testnet before
adding it (no guessed issuer keys).

Acceptance: typecheck/lint/build pass; a quick-pick fills the token input and
the purchase path uses the resolved address.

### M4 — PerEpoch partial-epoch edge case test

`settle` accrues `floor(elapsed / epoch_seconds)` epochs. Add unit tests for:
- elapsed time that is *not* a whole multiple of the epoch (partial epoch is
  ignored and not double-counted at the next settle),
- no-positive-elapsed settle panics with "No balance to settle",
- multiple settled epochs accumulate correctly.

Acceptance: new tests pass; existing 21 tests still pass.

## High (200 points)

### ~~H1 — Property tests for the accounting invariants~~ ✅ resolved

Add fuzz/property-style tests (e.g. `proptest` or a manual loop harness in the
`contract` test module) covering the invariants:

- `settled_total + pending_usage_on_active_licenses == total_earned` across a
  randomized sequence of record_usage / settle calls,
- `payable` never exceeds accumulated `usage_count * price`,
- flat licenses can never accrue `payable` or be settled,
- revoked licenses reject further `record_usage`.

Acceptance: randomized tests added and passing; CI still green.

> **Status**: Done. A deterministic manual-loop harness was added
> (`prop_per_query_accounting_invariants_randomized`, `prop_flat_license_never_accrues`,
> `prop_per_epoch_settled_total_is_monotonic`) — 26 contract tests pass.
> Keep this issue closed.

### H2 — Monitor + alerting for the indexer

Add structured log output and a lightweight liveness endpoint that reports
the indexer's last-seen ledger and the freshness of the newest indexed event
(lag in ledgers). Add a `backend/src/routes/health.ts` extension and document
a Prometheus-friendly scrape or a simple polling check in DEPLOYMENT.md.

Acceptance: `/health` (or `/health/indexer`) reports `lastIndexedLedgerSeq`
and lag; documented; backend checks pass.