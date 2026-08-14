import { SorobanRpc } from "@stellar/stellar-sdk";
import pino from "pino";
import { prisma } from "./db/client";
import {
  applyEvent,
  getIndexerCursor,
  nativizeEvent,
  setIndexerCursor,
} from "./services/indexer";

const logger = pino({ level: process.env.LOG_LEVEL || "info" });

const SOROBAN_RPC = process.env.SOROBAN_RPC_URL ?? "http://localhost:8000/soroban/rpc";
const CONTRACT_ID = process.env.CONTRACT_ID ?? "";
const POLL_INTERVAL_MS = parseInt(process.env.INDEXER_POLL_INTERVAL_MS ?? "5000", 10);
const PAGE_SIZE = 100;

if (!CONTRACT_ID) {
  logger.warn("CONTRACT_ID is not set; indexer will not match any events");
}

const rpc = new SorobanRpc.Server(SOROBAN_RPC, { allowHttp: SOROBAN_RPC.startsWith("http://") });

/**
 * Fetches and applies a page of contract events, persisting the cursor.
 * Returns whether there may be more events to fetch immediately.
 */
async function processPage(cursor: string | null): Promise<boolean> {
  const response = await rpc.getEvents({
    startLedger: cursor ? undefined : 0,
    cursor: cursor ?? undefined,
    limit: PAGE_SIZE,
    filters: [{ type: "contract", contractIds: [CONTRACT_ID] }],
  });

  const events = response.events ?? [];
  let applied = 0;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (!event.inSuccessfulContractCall) continue;

    const parsed = nativizeEvent(event, i);
    if (!parsed) continue;

    try {
      await applyEvent(prisma, parsed);
      applied++;
    } catch (err) {
      logger.error(err, "Failed to apply event %s", parsed.id);
    }
  }

  if (events.length > 0) {
    const last = events[events.length - 1];
    await setIndexerCursor(prisma, last.pagingToken);
  }

  logger.info(
    { applied, total: events.length, latestLedger: response.latestLedger },
    "Indexer page applied"
  );

  // If we got a full page back, there may be more to drain right away.
  return events.length === PAGE_SIZE;
}

async function indexOnce(): Promise<void> {
  let cursor = await getIndexerCursor(prisma);
  let more = true;

  while (more) {
    try {
      more = await processPage(cursor);
      cursor = await getIndexerCursor(prisma);
    } catch (err) {
      logger.error(err, "Indexer page failed");
      more = false;
    }
  }
}

async function main(): Promise<void> {
  await prisma.$connect();
  logger.info({ rpc: SOROBAN_RPC, contract: CONTRACT_ID }, "Indexer started");

  // eslint-disable-next-line no-constant-condition
  while (true) {
    await indexOnce();
    await sleep(POLL_INTERVAL_MS);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  logger.error(err, "Indexer crashed");
  process.exit(1);
});

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});