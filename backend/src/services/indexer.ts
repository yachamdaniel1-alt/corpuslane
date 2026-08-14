import type { PrismaClient } from "@prisma/client";
import {
  Address,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

export type LicenseType = "Flat" | "PerQuery" | "PerEpoch";

export interface LicenseTermsNative {
  type: LicenseType;
  price: string; // i128 as string
  epochSeconds?: number;
}

/**
 * Typed, decoupled representation of a Corpuslane contract event produced by
 * the Soroban indexer. All amounts are kept as decimal strings so that i128
 * fidelity is preserved end-to-end.
 */
export interface ParsedEvent {
  id: string; // `${txHash}:${eventIndex}`
  eventType: string;
  contractId: string;
  ledgerSeq: number;
  txHash: string;
  createdAt: Date;
  datasetId?: string; // hex of BytesN<32>
  licenseId?: number; // u64 -> number
  owner?: string;
  licensee?: string;
  caller?: string;
  attestor?: string;
  token?: string;
  metadataHash?: string; // hex of BytesN<32>
  terms?: LicenseTermsNative;
  usageCount?: number;
  delta?: string; // i128
  amount?: string; // i128
  topicJson: string;
  dataJson: string;
}

const EVENT_NAMES = new Set([
  "DatasetRegistered",
  "LicensePurchased",
  "UsageRecorded",
  "LicenseSettled",
  "LicenseRevoked",
  "AttestorSet",
]);

/**
 * Post-process the output of scValToNative into a JSON-safe structure.
 * - Buffers (BytesN) become 0x-hex strings
 * - BigInts become strings (i128/u64 fidelity)
 * - stellar-sdk Address instances become strkeys
 */
export function postNative(value: unknown): unknown {
  if (Buffer.isBuffer(value)) {
    return `0x${value.toString("hex")}`;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Address) {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(postNative);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = postNative(v);
    }
    return out;
  }
  return value;
}

export function parseTerms(native: unknown): LicenseTermsNative | undefined {
  if (native === null || typeof native !== "object") {
    return undefined;
  }
  const entries = Object.entries(native as Record<string, unknown>);
  if (entries.length !== 1) {
    return undefined;
  }
  const [variant, fields] = entries[0];
  const type = variant as LicenseType;
  const f = (fields ?? {}) as Record<string, unknown>;
  const price = String(f.price ?? "0");
  const epochSeconds =
    f.epochSeconds != null ? Number(f.epochSeconds) : undefined;
  return { type, price, epochSeconds };
}

function toNumberOrUndefined(v: unknown): number | undefined {
  if (v == null) return undefined;
  return Number(v);
}

function toHex(v: unknown): string | undefined {
  if (typeof v === "string" && v.startsWith("0x")) return v;
  if (Buffer.isBuffer(v)) return `0x${v.toString("hex")}`;
  return undefined;
}

/**
 * Converts a raw Soroban RPC event into the typed, JSON-safe form.
 *
 * Expects the parsed shape returned by `SorobanRpc.Server#getEvents`
 * (stellar-sdk v12): `topic: xdr.ScVal[]`, `value: xdr.ScVal`,
 * `contractId?: Contract`, `txHash`, `ledger`, `ledgerClosedAt`.
 */
export function nativizeEvent(raw: unknown, index: number): ParsedEvent | null {
  const e = raw as Record<string, unknown>;
  const eMeta = { ...e };
  // The contractId in the parsed event is a `Contract` instance; stringify it.
  if (e.contractId) {
    eMeta.contractId = String(e.contractId);
  }

  const rawTopics = eMeta.topic as xdr.ScVal[] | undefined;
  if (!rawTopics || rawTopics.length === 0) return null;

  const topicNative = rawTopics.map((t) => scValToNative(t));
  const eventName = String(topicNative[0] ?? "Unknown");
  if (!EVENT_NAMES.has(eventName)) return null;

  const txHash = String((eMeta.txHash ?? "") as string);
  const contractId = String((eMeta.contractId ?? "") as string);
  const ledgerSeq = Number((eMeta.ledger ?? 0) as number);
  const createdAt = new Date(String(eMeta.ledgerClosedAt ?? ""));

  const id = `${txHash}:${index}`;
  const data = eMeta.value ? scValToNative(eMeta.value as xdr.ScVal) : null;

  const parsed: ParsedEvent = {
    id,
    eventType: eventName,
    contractId,
    ledgerSeq,
    txHash,
    createdAt,
    topicJson: JSON.stringify(topicNative.map(postNative)),
    dataJson: JSON.stringify(postNative(data)),
  };

  // topics[1..] and data layout per event type (see contract/src/contract.rs)
  switch (eventName) {
    case "DatasetRegistered": {
      const [datasetId, owner] = topicNative.slice(1);
      parsed.datasetId = toHex(datasetId);
      parsed.owner = String(owner);
      const [metadataHash, terms] = Array.isArray(data) ? data : [];
      parsed.metadataHash = toHex(metadataHash);
      parsed.terms = parseTerms(terms);
      break;
    }
    case "LicensePurchased": {
      const [licenseId, datasetId, licensee] = topicNative.slice(1);
      parsed.licenseId = toNumberOrUndefined(licenseId);
      parsed.datasetId = toHex(datasetId);
      parsed.licensee = String(licensee);
      const [token, terms] = Array.isArray(data) ? data : [];
      parsed.token = String(token);
      parsed.terms = parseTerms(terms);
      break;
    }
    case "UsageRecorded": {
      const [licenseId, caller] = topicNative.slice(1);
      parsed.licenseId = toNumberOrUndefined(licenseId);
      parsed.caller = String(caller);
      const [usageCount, delta] = Array.isArray(data) ? data : [];
      parsed.usageCount = toNumberOrUndefined(usageCount);
      parsed.delta = delta != null ? String(delta) : "0";
      break;
    }
    case "LicenseSettled": {
      const [licenseId, caller] = topicNative.slice(1);
      parsed.licenseId = toNumberOrUndefined(licenseId);
      parsed.caller = String(caller);
      const [amount] = Array.isArray(data) ? data : [];
      parsed.amount = amount != null ? String(amount) : "0";
      break;
    }
    case "LicenseRevoked": {
      const [licenseId, datasetId] = topicNative.slice(1);
      parsed.licenseId = toNumberOrUndefined(licenseId);
      parsed.datasetId = toHex(datasetId);
      break;
    }
    case "AttestorSet": {
      const [datasetId, attestor] = topicNative.slice(1);
      parsed.datasetId = toHex(datasetId);
      parsed.attestor = String(attestor);
      break;
    }
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// Cursor state
// ---------------------------------------------------------------------------

export async function getIndexerCursor(prisma: PrismaClient): Promise<string | null> {
  const row = await prisma.indexerState.findUnique({ where: { id: 1 } });
  return row?.cursor ?? null;
}

export async function setIndexerCursor(prisma: PrismaClient, cursor: string): Promise<void> {
  await prisma.indexerState.upsert({
    where: { id: 1 },
    update: { cursor },
    create: { id: 1, cursor },
  });
}

// ---------------------------------------------------------------------------
// Event application
// ---------------------------------------------------------------------------

function datasetTermsFields(terms: LicenseTermsNative): {
  licenseType: string;
  price: string;
  epochSeconds: number | null;
} {
  return {
    licenseType: terms.type,
    price: terms.price,
    epochSeconds: terms.epochSeconds ?? null,
  };
}

function licenseTermsFields(terms: LicenseTermsNative): {
  termsType: string;
  price: string;
  epochSeconds: number | null;
} {
  return {
    termsType: terms.type,
    price: terms.price,
    epochSeconds: terms.epochSeconds ?? null,
  };
}

/**
 * Applies one parsed contract event to the read model.
 * Each event handler is idempotent under re-indexing thanks to upserts and
 * the Event table's primary key.
 */
export async function applyEvent(prisma: PrismaClient, ev: ParsedEvent): Promise<void> {
  await prisma.event.upsert({
    where: { id: ev.id },
    update: {},
    create: {
      id: ev.id,
      eventType: ev.eventType,
      contractId: ev.contractId,
      ledgerSeq: ev.ledgerSeq,
      txHash: ev.txHash,
      createdAt: ev.createdAt,
      topicJson: ev.topicJson,
      dataJson: ev.dataJson,
    },
  });

  switch (ev.eventType) {
    case "DatasetRegistered": {
      if (!ev.datasetId || !ev.owner || !ev.metadataHash || !ev.terms) return;
      await prisma.dataset.upsert({
        where: { id: ev.datasetId },
        update: {},
        create: {
          id: ev.datasetId,
          owner: ev.owner,
          metadataHash: ev.metadataHash,
          ...datasetTermsFields(ev.terms),
          registeredAt: ev.createdAt,
          ledgerSeq: ev.ledgerSeq,
          txHash: ev.txHash,
        },
      });
      break;
    }
    case "LicensePurchased": {
      if (ev.licenseId == null || !ev.datasetId || !ev.licensee || !ev.token || !ev.terms) {
        return;
      }
      const dataset = await prisma.dataset.findUnique({ where: { id: ev.datasetId } });
      if (!dataset) return; // orphaned until DatasetRegistered is indexed
      const settledTotal =
        ev.terms.type === "Flat" ? ev.terms.price : "0";
      await prisma.license.upsert({
        where: { id: ev.licenseId },
        update: {},
        create: {
          id: ev.licenseId,
          datasetId: ev.datasetId,
          licensee: ev.licensee,
          token: ev.token,
          ...licenseTermsFields(ev.terms),
          status: "Active",
          purchasedAt: ev.createdAt,
          usageCount: 0n,
          payable: "0",
          settledTotal,
          lastSettleTs: BigInt(Math.floor(ev.createdAt.getTime() / 1000)),
        },
      });
      break;
    }
    case "UsageRecorded": {
      if (ev.licenseId == null || ev.caller == null) return;
      const license = await prisma.license.findUnique({ where: { id: ev.licenseId } });
      if (!license) return;
      const usage = BigInt(ev.usageCount ?? 0);
      const delta = BigInt(ev.delta ?? "0");
      await prisma.$transaction([
        prisma.usageRecord.create({
          data: {
            licenseId: ev.licenseId,
            licensee: license.licensee,
            reporter: ev.caller,
            usageCount: usage,
            delta: delta.toString(),
            recordedAt: ev.createdAt,
            ledgerSeq: ev.ledgerSeq,
            txHash: ev.txHash,
          },
        }),
        prisma.license.update({
          where: { id: ev.licenseId },
          data: {
            usageCount: { increment: usage },
            payable: (BigInt(license.payable) + delta).toString(),
          },
        }),
      ]);
      break;
    }
    case "LicenseSettled": {
      if (ev.licenseId == null || ev.caller == null || ev.amount == null) return;
      const license = await prisma.license.findUnique({ where: { id: ev.licenseId } });
      if (!license) return;
      const amount = BigInt(ev.amount);
      const settledAtSec = Math.floor(ev.createdAt.getTime() / 1000);
      let lastSettleTs = license.lastSettleTs;
      if (license.termsType === "PerEpoch" && license.epochSeconds) {
        const base = lastSettleTs;
        const elapsed = Math.max(0, settledAtSec - Number(base));
        const epochs = Math.floor(elapsed / license.epochSeconds);
        lastSettleTs = base + BigInt(epochs * license.epochSeconds);
      }
      await prisma.$transaction([
        prisma.settlement.create({
          data: {
            licenseId: ev.licenseId,
            amount: amount.toString(),
            caller: ev.caller,
            settledAt: ev.createdAt,
            ledgerSeq: ev.ledgerSeq,
            txHash: ev.txHash,
          },
        }),
        prisma.license.update({
          where: { id: ev.licenseId },
          data: {
            payable: "0",
            settledTotal: (BigInt(license.settledTotal) + amount).toString(),
            lastSettleTs,
          },
        }),
      ]);
      break;
    }
    case "LicenseRevoked": {
      if (ev.licenseId == null) return;
      const license = await prisma.license.findUnique({ where: { id: ev.licenseId } });
      if (!license) return;
      const owner = (
        await prisma.dataset.findUnique({ where: { id: license.datasetId } })
      )?.owner;
      await prisma.$transaction([
        prisma.license.update({
          where: { id: ev.licenseId },
          data: { status: "Revoked" },
        }),
        prisma.licenseRevocation.upsert({
          where: { licenseId: ev.licenseId },
          update: {
            revokedBy: owner ?? "unknown",
            revokedAt: ev.createdAt,
            ledgerSeq: ev.ledgerSeq,
            txHash: ev.txHash,
          },
          create: {
            licenseId: ev.licenseId,
            revokedBy: owner ?? "unknown",
            revokedAt: ev.createdAt,
            ledgerSeq: ev.ledgerSeq,
            txHash: ev.txHash,
          },
        }),
      ]);
      break;
    }
    default:
      // AttestorSet and any future events are recorded in the Event table
      // only.
      break;
  }
}
