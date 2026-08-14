# API

The backend is a **read-only** REST API: it never writes to the contract or
changes any state. On-chain mutations are performed by users signing
transactions in the frontend via Freighter; this API only mirrors what has
already been indexed from the ledger.

Base URL: `http://localhost:3001` (overridable with `NEXT_PUBLIC_API_URL`).

**Amounts** (`price`, `payable`, `settledTotal`, `delta`, `usageCount`,…) are
decimal strings in the token&apos;s **smallest units** (e.g. stroops for XLM).
Contract amounts are `i128`, which can exceed PostgreSQL `int8`, hence strings.
Convert using the payment token&apos;s decimals when displaying.

**Identifiers**: dataset ids and metadata hashes are 32-byte hex (without the
`0x` prefix) as stored for `BytesN<32>`; addresses are `G…`/`C…` strkeys.

---

## `GET /health`

Health check that also verifies the database connection.

- `200` → `{ "status": "ok", "database": "connected" }`
- `503` → `{ "status": "degraded", "database": "unreachable" }`

## `GET /api/datasets`

List datasets. Query params:

| Param | Type | Description |
| --- | --- | --- |
| `owner` | string | Narrow to a dataset owner address. |
| `licenseType` | `Flat` \| `PerQuery` \| `PerEpoch` | Filter by terms type. |
| `limit` | int (1–100, default 50) | Page size. |
| `offset` | int (≥0, default 0) | Paging offset. |

Response:

```jsonc
{
  "datasets": [
    {
      "id": "0123…",                    // hex BytesN<32>, lowercase, no 0x
      "owner": "G…",
      "metadataHash": "4567…",          // hex BytesN<32>
      "licenseType": "PerQuery",
      "price": "100",                   // smallest token units
      "epochSeconds": null,             // PerEpoch only
      "registeredAt": "2026-08-13T…Z",
      "licenseCount": 2,
      "ledgerSeq": 12345 | null,
      "txHash": "abcd…" | null
    }
  ],
  "pagination": { "limit": 50, "offset": 0, "total": 1 }
}
```

`400` on invalid params.

## `GET /api/datasets/:id`

Single dataset (same shape as the list items above). `404` if unknown.

## `GET /api/datasets/:id/licenses`

Licenses issued against one dataset.

```jsonc
{
  "datasetId": "…",
  "licenseCount": 2,
  "totalRecordedUsage": "150",
  "licenses": [
    {
      "id": 3,                          // on-chain u64
      "licensee": "G…",
      "token": "C…",
      "termsType": "PerQuery",
      "price": "100",
      "epochSeconds": null,
      "status": "Active",               // Active | Revoked
      "purchasedAt": "2026-08-13T…Z",
      "usageCount": "150",
      "payable": "15000",
      "settledTotal": "0",
      "revocation": null
    }
  ]
}
```

## `GET /api/licenses/:id`

Full license detail with usage / settlement / revocation history.

```jsonc
{
  "id": 3,
  "dataset": { "id": "…", "owner": "G…", "metadataHash": "…",
               "licenseType": "PerQuery", "price": "100", "epochSeconds": null },
  "licensee": "G…",
  "token": "C…",
  "termsType": "PerQuery",
  "price": "100",
  "epochSeconds": null,
  "status": "Active",
  "purchasedAt": "…",
  "usageCount": "150",
  "payable": "15000",
  "settledTotal": "0",
  "lastSettleTs": "1755…",
  "usageRecords": [
    { "reporter": "G…", "usageCount": "50", "delta": "5000",
      "recordedAt": "…", "ledgerSeq": 12346, "txHash": "…" }
  ],
  "settlements": [
    { "amount": "10000", "caller": "G…", "settledAt": "…",
      "ledgerSeq": 12355, "txHash": "…" }
  ],
  "revocation": null
}
```

`404` for unknown ids; `400` for non-positive-integer ids.

---

## Error format

All errors use `{ "error": { "message": "…", "details": … } }`.

| Code | Meaning |
| --- | --- |
| 400 | Invalid query/param |
| 404 | Resource not found |
| 500 | Server error |

## Event indexer

The indexer populates the API by polling `soroban-rpc` `getTransactions` and
handling these contract events: `DatasetRegistered`, `LicensePurchased`,
`UsageRecorded`, `LicenseSettled`, `LicenseRevoked`, `AttestorSet`. Events that
don&apos;t map to a materialized table (e.g. `AttestorSet`) are stored verbatim in
the generic `Event` table so nothing is silently dropped.