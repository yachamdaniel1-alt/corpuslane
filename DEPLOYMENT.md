# Deployment

This guide walks through deploying all three layers: the **contract** on
Soroban testnet, the **backend + indexer** with PostgreSQL, and the
**frontend**.

> Status note: the contract below has been deployed to Soroban **testnet**
> (`CAUFA5YVBHOVKEJNLCDY6NLXPOM22ANGTE6PFNMSAHM7LFA2UIIB7BUS`) and the
> indexer + API were run against it, mirroring a live dataset / license /
> usage / settlement. docker/docker-compose and `scripts/deploy-testnet.sh`
> have **not** been exercised in the repo&apos;s development environment, so test
> those before going live.

## 0. Prerequisites

- Rust 1.84+ (needed for the `wasm32v1-none` target)
- `stellar` CLI v21+ (the Soroban CLI; replaces the deprecated `soroban` CLI)
- Node 20+, PostgreSQL, and Docker (for the containerized stack)
- Freighter wallet with a funded testnet account (`friendbot` to fund)

## 1. Deploy the contract

```bash
# one-time
rustup target add wasm32v1-none

# build + test locally first
cd contract
cargo test --features testutils
cargo build-wasm

# deploy (see scripts/deploy-testnet.sh)
export DEPLOYER_SECRET=SB…   # your funded account secret key
./scripts/deploy-testnet.sh
```

Or deploy directly with the `stellar` CLI:

```bash
stellar contract deploy \
  --wasm contract/target/wasm32v1-none/release/corpuslane.wasm \
  --source "$DEPLOYER_SECRET" \
  --rpc-url https://soroban-testnet.stellar.org:443 \
  --network-passphrase "Test SDF Network ; September 2015"
```

The deploy prints `CONTRACT_ID` (`C…`). Keep it; it goes into env config
below.

**Testnet funding:** newly deployed contracts on testnet may need funding /
ledger-restore (bumping reserve) before they can be written to at scale. Use
`friendbot` or the RPC&apos;s `sendTransaction` to top the contract account up
and run any wizard tooling your CLI provides for `restoreFootprint`.

**Exercising the contract (testnet smoke flow):**

```bash
CID=C…; DID=0100…00; MH=abab…ab   # 32-byte hex ids
stellar contract invoke --id "$CID" --source "$OWNER_SK" --rpc-url https://soroban-testnet.stellar.org:443 --network-passphrase "Test SDF Network ; September 2015" -- \
  register_dataset --owner "$OWNER" --dataset_id "$DID" --metadata_hash "$MH" --license_terms '{"PerQuery":"5"}'
stellar contract invoke --id "$CID" --source "$LICENSEE_SK" --rpc-url https://soroban-testnet.stellar.org:443 --network-passphrase "Test SDF Network ; September 2015" -- \
  purchase_license --dataset_id "$DID" --licensee "$LICENSEE" --token "$NATIVE_SAC" --payment 0
# approve the contract to pull payment (native SAC allowance expiry is capped
# at ~3,110,400 ledgers ahead):
stellar contract invoke --id "$NATIVE_SAC" --source "$LICENSEE_SK" --rpc-url https://soroban-testnet.stellar.org:443 --network-passphrase "Test SDF Network ; September 2015" -- \
  approve --from "$LICENSEE" --spender "$CID" --amount 1000000000 --live_until_ledger "$(($(stellar ledger latest-ledger ...) + 3000000))"
stellar contract invoke --id "$CID" --source "$LICENSEE_SK" --rpc-url https://soroban-testnet.stellar.org:443 --network-passphrase "Test SDF Network ; September 2015" -- \
  record_usage --license_id 1 --caller "$LICENSEE" --usage_count 3
stellar contract invoke --id "$CID" --source "$OWNER_SK" --rpc-url https://soroban-testnet.stellar.org:443 --network-passphrase "Test SDF Network ; September 2015" -- \
  settle --license_id 1 --caller "$OWNER"
```

## 2. Backend + indexer

Two ways:

### A. Plain (requires your own Postgres)

```bash
cd backend
createdb corpuslane
cp .env.example .env
# edit .env: DATABASE_URL, CONTRACT_ID, SOROBAN_RPC_URL, etc.
npm install
npm run db:push            # apply Prisma schema
npm run build
npm start                  # API on :3001
# in a second terminal:
npm run indexer            # event indexer
```

### B. Docker (db + backend + indexer + frontend, one command)

```bash
# at the repo root with CONTRACT_ID exported:
export CONTRACT_ID=C…
docker compose up --build
# backend         → http://localhost:3001
# frontend        → http://localhost:3000
# postgres        → localhost:5432 (user=corpuslane pass=$POSTGRES_PASSWORD default corpuslane)
```

The `backend` container runs `prisma db push` before starting so the schema is
always current. The `indexer` container runs the same image with the indexer
entrypoint.

## 3. Frontend

```bash
cd frontend
cp .env.example .env.local
# edit next variables
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_CONTRACT_ID=C…
npm install
npm run build
npm start                 # http://localhost:3000
```

Or use the Docker route above, which inlines `NEXT_PUBLIC_*` from
`CONTRACT_ID` / `SOROBAN_*` for you.

## 4. Smoke test

1. Open `http://localhost:3000/owner` and connect Freighter.
2. Register a dataset (id + metadata hash as 32-byte hex; choose terms).
3. Open `/licensee`, approve a payment token, purchase a license.
4. Report usage (PerQuery) and settle; confirm the owner&apos;s “Royalties
   settled” figure rises and the API reflects it.
5. `curl http://localhost:3001/health` should report the DB connected.

## 5. Production considerations

- **Postgres**: use a managed instance; set `DATABASE_URL` accordingly. Run
  `prisma migrate deploy` in CI/CD rather than `db push`.
- **Secrets**: `.env` files are gitignored. Never commit real `DEPLOYER_SECRET`
  or token allowances.
- **HTTPS + CORS**: the current backend doesn&apos;t set CORS and the contract
  doesn&apos;t need one; if you expose the API cross-origin, add a
  `CORS_ALLOWED_ORIGIN` to the backend. Put the frontend and backend behind the
  same origin (reverse proxy) for simplicity.
- **Long-lived state**: Soroban has ledger entry TTL (live-until). The contract
  self-refreshes dataset / license / attestor TTL on every write
  (`TTL_EXTEND_TO = 1_000_000` ledgers, `contract/src/storage.rs`). Still
  schedule a keep-alive for the **contract instance and WASM** and for
  infrequently-written entries: a cron job running `stellar contract extend`
  (`--wasm-hash` / instance key) with a generous `--ledgers-to-extend`, plus a
  periodic `RestoreFootprintOp` after any downtime longer than the TTL window.
  Otherwise the read-only mirror goes stale and reads start failing on
  archived entries.
- **Metering honesty**: production “per query” licensing needs an attestor
  that measures usage off-chain — see SECURITY.md before going live.

## 6. Tearing down

```bash
docker compose down -v      # removes the Postgres volume too
```

That removes the local mirror. On-chain state (datasets, licenses) persists on
the ledger until the contract&apos;s entries expire — the mirror never was the
source of truth.