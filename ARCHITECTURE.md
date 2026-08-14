# Architecture

Corpuslane is three independent parts: an on-chain Soroban contract (the only
source of truth for money and licensing), an off-chain read-only indexer + API
(a PostgreSQL mirror for fast reads and UIs), and a Next.js frontend that signs
transactions with Freighter.

```
                 ┌──────────────────────────── Soroban ledger ────────────────────────────┐
                 │                                                                          │
                 │   RegisteredDataset · Flat/PerQuery/PerEpoch terms                      │
                 │   License · usage_count · payable · settled_total · status              │
                 │   Attestor delegation                                                  │
                 └───────────────▲───────────────────────▲────────────────────────────────┘
                                 │                       │ invoke (signed,  token XFER)
        off-chain mirror         │                       │
                 ┌───────────────┴──────────┐   ┌────────┴────────────┐
                 │ backend indexer          │   │ frontend            │
                 │ getTransactions?  poll   │   │ Freighter signing   │
                 │ convert events → Prisma  │   │ API reads for lists │
                 └───────────────▲──────────┘   └───────▲─────────────┘
                                 │ PostgreSQL          │
                                 │ (read-mostly)       │
                                 └─────────────────────┘
```

## Contract (`contract/`)

- **State (soroban-sdk storage):**
  - `Dataset` keyed by `DatasetKey::Dataset(BytesN<32>)` — owner, dataset id,
    metadata hash (`BytesN<32>`, content-address of an off-chain metadata
    file), `LicenseTerms`, `registered_at`, license count.
  - `License` keyed by `LicenseKey::License(u64)` — terms, licensee, token,
    `usage_count`, `payable`, `settled_total`, `last_settle_timestamp`,
    `status`, `purchased_at`.
  - `Attestor` keyed by `AttestorKey::Attestor(BytesN<32>)` — optional
    delegated usage reporter.
  - License ids come from a monotonic counter.
- **Storage keys.** All top-level keys are distinct enum variants
  (`DatasetKey::Dataset`, `LicenseKey::License`, `AttestorKey::Attestor`) so a
  u64 license id and a `BytesN<32>` dataset id can never collide in storage.
- **Terms:**
  - `Flat(price)` — validated equal to `payment` at purchase; the full amount
    is transferred to the owner immediately; nothing to settle later.
  - `PerQuery(price)` — zero upfront; each `record_usage(n)` call accrues
    `n * price` to `payable`.
  - `PerEpoch(price, epoch_seconds)` — zero upfront; `settle` first accrues
    `floor(elapsed / epoch_seconds) * price` for elapsed epochs since the last
    settlement, then pays out `payable`.
- **Auth:** every mutating call requires `caller.require_auth()`. Owner-only:
  `register_dataset`, `set_attestor`, `revoke_license`. Usage may be recorded
  by the licensee *or* the dataset&apos;s attestor. `settle` is permissionless
  (caller never touches funds; tokens flow licensee → owner).
- **Events:** `DatasetRegistered`, `LicensePurchased`, `UsageRecorded`,
  `LicenseSettled`, `LicenseRevoked`, `AttestorSet`. These are the indexer&apos;s
  input.

## Backend (`backend/`)

- **`src/indexer.ts`** polls the Soroban RPC `getTransactions` on an interval
  (`INDEXER_POLL_INTERVAL_MS`), decodes contract events, and upserts rows via
  Prisma. It is **read-only with respect to the ledger** — it never sends
  transactions. Idempotent by `txHash`/`ledgerSeq`.
- **`src/routes/*`** expose a read-only REST API (no POST/PATCH). Amounts are
  transmitted as decimal strings because contract amounts are `i128`, which
  exceeds Postgres `int8`. Callers convert using the token&apos;s decimals
  (see [API.md](API.md)).
- **`prisma/schema.prisma`** mirrors contract entities: `Dataset`, `License`,
  `UsageRecord`, `Settlement`, `Revocation`, plus a generic `Event` table for
  anything the indexer doesn&apos;t know how to materialize (e.g. attestor
  changes).

## Frontend (`frontend/`)

- **`/owner`** — connect Freighter, register datasets (id, metadata hash,
  terms), see royalty totals per dataset and per license, revoke licenses.
- **`/licensee`** — browse datasets, approve the payment token and purchase a
  license, report usage on PerQuery licenses, settle accrued royalties.
- **`src/lib/contract.ts`** — ScVal builders and signed `invokeContract`
  plumbing (simulate → assemble → Freighter sign → submit → poll). All
  transactions are built with `@stellar/stellar-sdk` (v12) and signed by the
  user in Freighter.
- **`src/lib/api.ts`** — typed client for the backend&apos;s list/detail reads.

## Trust boundaries

The ledger and the deserialized contract state are the only trustworthy
source. The backend mirror is a convenience: it can be missing, stale, or even
malicious without affecting settlement, because payments are enforced entirely
in the contract. The frontend is pure UX; it never holds keys.

Escrow is deliberately avoided: flat payments and settlement transfers go
directly to the owner. A licensee pays only what they have approved —
there is no pre-funded vault for the protocol to get wrong.