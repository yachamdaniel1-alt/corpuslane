# Security

This document is the honest version of the trust model. Corpuslane is a
starting point for dataset licensing, not a production-grade payments system.
Read this before deploying or relying on it.

## Summary

| Claim | Verdict |
| --- | --- |
| Flat licensing is on-chain and trustless for the money path | ✅ |
| PerQuery/PerEpoch accounting is on-chain | ✅ |
| Usage metering is trustless (can&apos;t be gamed) | ❌ **No** — see below |
| The backend mirror is required for correctness | ❌ No — it is read-only |

## The core limit: metered usage depends on who reports it

For `PerQuery` (and by extension `PerEpoch`, which is time-based so far less
gameable), the amount the owner earns is a function of reported usage:

```
payable += reported_units * price
```

`record_usage` accepts either the **licensee** or the dataset&apos;s delegated
**attestor**:

- **Self-reporting licensee** — a rational licensee can *under-report* the
  actual number of queries they made in order to pay less. On a public ledger
  they are the only one who knows the true count. There is **no on-chain
  mechanism to prove** the true number of queries. This is an inherent
  limitation of this design.
- **Delegated attestor** — `set_attestor` lets the dataset owner designate a
  reporter that measures usage *off-chain* (e.g. from the owner&apos;s serving
  logs) and reports it on-chain. This restores economic honesty **only if** the
  attestor is independent of the licensee and the licensee cannot route around
  it without paying. If both licensee and attestor are written by the same
  party, this degenerates to self-reporting again.

### What this means in practice

- For a **data marketplace demo / pilot with cooperative or contractually
  bound licensees**, self-reported usage plus smart-contract settlement is a
  reasonable v1.
- For **untrusted licensees at scale**, you need an off-chain measurement
  layer (server-side logging, watermarking, model-call accounting) feeding a
  trusted attestor, and the license agreement must make the reported ledger
  value the legally binding one.

**Do not advertise Corpuslane as a trustless usage oracle.** It is a
meter-trust framework: the *accounting and flow of funds* are trustless; the
*meter itself* is only as honest as the entity allowed to write to it.

## Money-path invariants

- Every transfer is `transfer_from` from the licensee&apos;s allowance; Corpuslane
  never custodies funds. There is no vault to drain.
- `Flat`: payment must equal the registered price or the call panics.
- `PerQuery`/`PerEpoch`: `payment` must be `0` at purchase; you cannot
  over-pay into an account.
- `settle` pays `payable` to the dataset owner only; the settling caller
  receives nothing, so there is no incentive to grief-settle or steal.
- Revocation does not destroy accrued `payable` semantics as documented; note
  that the current `settle` rejects revoked licenses (see Known issues).

## Known issues / hardening backlog

1. **Revoked-license settlement discrepancy.** The `revoke_license` docstring
   says accrued royalties remain claimable, but `settle` panics on revoked
   licenses. Decide which is intended and align the contract. (Tests pass
   against current behavior.)
2. **PerEpoch clock.** Epochs accrue at settlement time based on
   `last_settle_timestamp`. A long gap between settlements front-loads the
   count (late settles catch up), which is fine, but the timestamp comes from
   ledger time — acceptable on a ledger you trust.
3. **No pause / emergency stop.** There is no kill switch. If a flaw is found
   the only remedy is redeploying a new contract and pointing the frontend at
   it; existing licenses remain.
4. **Denial-of-service by spam.** `record_usage` and `settle` are cheap for
   anyone to call subject to auth; settlement `transfer_from` requires an
   allowance. Consider rate/cost modeling on high-throughput datasets.
5. **Re-entrancy.** Soroban's synchronous execution model prevents the classic
   cross-contract re-entrancy that plagues EVM chains (no `delegatecall`, no
   re-entry into the same invocation frame), so this is not exploitable here.
   `settle` nevertheless applies Checks-Effects-Interactions: it commits the
   accounting change before the external token `transfer_from` (contract.rs).
   If the token is a custom SEP-41 contract rather than a SAC, review its
   behavior before relying on it.
6. **State expiration / rent (TTL).** Soroban ledger entries expire unless
   their TTL is refreshed. The contract extends the TTL of every dataset /
   license / attestor entry on each write (`TTL_EXTEND_TO = 1_000_000` ledgers,
   storage.rs). For long-lived deployments a keep-alive bot should still bump
   the contract instance and WASM TTL, and infrequently-written entries should
   be refreshed periodically — see DEPLOYMENT.md. Note TTL expiry is *not* a
   reliable security boundary (extension is permissionless); never rely on it
   for authorization or expiration logic. The contract uses ledger timestamps,
   not TTL, for epoch accounting, which is the recommended pattern.
7. **Off-chain indexer.** The indexer never writes to the ledger, so a
   compromise of the backend cannot spend funds — but it can display wrong
   data. Verify ledger state directly (`get_license`, `get_dataset`) before
   high-value decisions.

## Threat model (TL;DR)

- **Attacker = dataset owner**: can set attestors (expected), revoke licenses
  (owner-only by design), register bogus datasets. Cannot mint tokens or alter
  licensees&apos; funds.
- **Attacker = licensee**: can under-report usage to underpay (by design,
  mitigated by attestors); cannot withdraw anything the owner owns. Cannot
  over-draw beyond a properly scoped token allowance.
- **Attacker = random user**: can call `settle` for any license (harmless —
  funds go to the owner, caller gets nothing).
- **Attacker = network/Soroban RPC** (the thing the indexer trusts): can lie
  to the indexer; cannot fake ledger state that a client verifies directly.

## Dependencies / supply chain

- Rust: `soroban-sdk = 27.0.6` (pinned `=`, not `^`).
- Backend: `@stellar/stellar-sdk ^12`, express, prisma, zod, pino — standard
  audit + Dependabot + lockfiles recommended.
- Frontend: Next.js 14.2, `@stellar/freighter-api`, freighter-driven signing
  (keys never leave the browser).

## Reporting issues

Please open an issue (or responsible-disclosure PR) for anything in **Known
issues** or the threat model. Do not include real secrets or allowances in
reports.