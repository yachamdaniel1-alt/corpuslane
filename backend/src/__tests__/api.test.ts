import express, { Express } from "express";
import request from "supertest";
import type { PrismaClient } from "@prisma/client";
import { datasetRoutes } from "../routes/datasets";
import { licenseRoutes } from "../routes/licenses";
import { healthRoute } from "../routes/health";
import { errorHandler, notFoundHandler } from "../middleware/errorHandler";

interface DatasetRow {
  id: string;
  owner: string;
  metadataHash: string;
  licenseType: string;
  price: string;
  epochSeconds: number | null;
  registeredAt: Date;
  ledgerSeq: number | null;
  txHash: string | null;
}

interface LicenseRow {
  id: number;
  datasetId: string;
  licensee: string;
  token: string;
  termsType: string;
  price: string;
  epochSeconds: number | null;
  status: string;
  purchasedAt: Date;
  usageCount: bigint;
  payable: string;
  settledTotal: string;
}

/**
 * Minimal in-memory Prisma store backing the routes under test. Implements
 * only the surface the routes exercise, so the smoke test needs no database.
 */
class InMemoryStore {
  datasets: DatasetRow[] = [];
  licenses: LicenseRow[] = [];

  $queryRaw = async (): Promise<Array<Record<string, number>>> => [{ "?column?": 1 }];

  dataset = {
    findMany: async (args: {
      where?: { owner?: string; licenseType?: string };
      include?: { _count?: { select: { licenses?: boolean } } };
      orderBy?: { registeredAt: "asc" | "desc" };
      take?: number;
      skip?: number;
    }): Promise<Array<Record<string, unknown>>> => {
      const filtered = this.datasets.filter(
        (d) =>
          (!args.where?.owner || d.owner === args.where.owner) &&
          (!args.where?.licenseType || d.licenseType === args.where.licenseType)
      );
      const sorted = [...filtered].sort((a, b) =>
        args.orderBy?.registeredAt === "asc"
          ? a.registeredAt.getTime() - b.registeredAt.getTime()
          : b.registeredAt.getTime() - a.registeredAt.getTime()
      );
      const page = args.skip || args.take ? sorted.slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? sorted.length)) : sorted;
      return page.map((d) =>
        args.include?._count
          ? { ...d, _count: { licenses: this.licenses.filter((l) => l.datasetId === d.id).length } }
          : { ...d }
      );
    },

    count: async (args?: { where?: { owner?: string; licenseType?: string } }): Promise<number> =>
      this.datasets.filter(
        (d) =>
          (!args?.where?.owner || d.owner === args.where.owner) &&
          (!args?.where?.licenseType || d.licenseType === args.where.licenseType)
      ).length,

    findUnique: async (args: {
      where: { id: string };
      include?: { _count?: { select: { licenses?: boolean } } };
    }): Promise<Record<string, unknown> | null> => {
      const found = this.datasets.find((d) => d.id === args.where.id);
      if (!found) return null;
      return args.include?._count
        ? { ...found, _count: { licenses: this.licenses.filter((l) => l.datasetId === found.id).length } }
        : { ...found };
    },
  };

  license = {
    findMany: async (args: {
      where: { datasetId: string };
      orderBy?: { purchasedAt: "asc" | "desc" };
    }): Promise<LicenseRow[]> =>
      this.licenses
        .filter((l) => l.datasetId === args.where.datasetId)
        .sort((a, b) =>
          args.orderBy?.purchasedAt === "asc"
            ? a.purchasedAt.getTime() - b.purchasedAt.getTime()
            : b.purchasedAt.getTime() - a.purchasedAt.getTime()
        )
        .map((l) => ({ ...l })),

    aggregate: async (args: {
      where: { datasetId: string };
      _sum: { usageCount: boolean };
    }): Promise<{ _sum: { usageCount: bigint | null } }> => {
      const sum = this.licenses
        .filter((l) => l.datasetId === args.where.datasetId)
        .reduce((acc, l) => acc + (args._sum.usageCount ? l.usageCount : 0n), 0n);
      return { _sum: { usageCount: sum } };
    },

    findUnique: async (args: { where: { id: number } }): Promise<LicenseRow | null> => {
      const found = this.licenses.find((l) => l.id === args.where.id);
      return found ? { ...found } : null;
    },
  };
}

function buildApp(store: InMemoryStore): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/datasets", datasetRoutes(store as unknown as PrismaClient));
  app.use("/api/licenses", licenseRoutes(store as unknown as PrismaClient));
  app.use("/health", healthRoute(store as unknown as PrismaClient));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe("Corpuslane backend API", () => {
  let store: InMemoryStore;
  let app: Express;

  beforeEach(() => {
    store = new InMemoryStore();
    store.datasets.push(
      {
        id: "a".repeat(64),
        owner: "GOWNER1",
        metadataHash: "0xabc",
        licenseType: "PerQuery",
        price: "100",
        epochSeconds: null,
        registeredAt: new Date("2026-01-01T00:00:00Z"),
        ledgerSeq: 10,
        txHash: "tx1",
      },
      {
        id: "b".repeat(64),
        owner: "GOWNER2",
        metadataHash: "0xdef",
        licenseType: "Flat",
        price: "500",
        epochSeconds: null,
        registeredAt: new Date("2026-01-02T00:00:00Z"),
        ledgerSeq: 11,
        txHash: "tx2",
      },
      {
        id: "c".repeat(64),
        owner: "GOWNER1",
        metadataHash: "0x123",
        licenseType: "PerEpoch",
        price: "7",
        epochSeconds: 86400,
        registeredAt: new Date("2026-01-03T00:00:00Z"),
        ledgerSeq: 12,
        txHash: "tx3",
      }
    );
    store.licenses.push({
      id: 1,
      datasetId: "a".repeat(64),
      licensee: "GUSER1",
      token: "CUSDC",
      termsType: "PerQuery",
      price: "100",
      epochSeconds: null,
      status: "Active",
      purchasedAt: new Date("2026-01-05T00:00:00Z"),
      usageCount: 3n,
      payable: "300",
      settledTotal: "0",
    });
    app = buildApp(store);
  });

  it("GET /health returns 200 with status ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.database).toBe("ok");
  });

  it("GET /api/datasets returns the paginated shape", async () => {
    const res = await request(app).get("/api/datasets");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("datasets");
    expect(res.body).toHaveProperty("pagination");
    expect(Array.isArray(res.body.datasets)).toBe(true);
    expect(res.body.datasets).toHaveLength(3);
    expect(res.body.pagination).toEqual({ limit: 50, offset: 0, total: 3 });
    // newest first
    expect(res.body.datasets[0].id).toBe("c".repeat(64));
  });

  it("GET /api/datasets honors limit/offset pagination", async () => {
    const res = await request(app).get("/api/datasets?limit=2&offset=1");
    expect(res.status).toBe(200);
    expect(res.body.datasets).toHaveLength(2);
    expect(res.body.pagination).toEqual({ limit: 2, offset: 1, total: 3 });
    expect(res.body.datasets[0].id).toBe("b".repeat(64));
  });

  it("GET /api/datasets filters by owner", async () => {
    const res = await request(app).get("/api/datasets?owner=GOWNER1");
    expect(res.status).toBe(200);
    expect(res.body.datasets).toHaveLength(2);
    expect(res.body.pagination.total).toBe(2);
  });

  it("GET /api/datasets rejects invalid query params", async () => {
    const res = await request(app).get("/api/datasets?limit=0");
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Invalid query parameters/);
  });

  it("GET /api/datasets/:id returns 404 for an unknown dataset", async () => {
    const res = await request(app).get(`/api/datasets/${"f".repeat(64)}`);
    expect(res.status).toBe(404);
    expect(res.body.error.message).toMatch(/Dataset not found/);
  });

  it("GET /api/datasets/:id returns the dataset", async () => {
    const res = await request(app).get(`/api/datasets/${"a".repeat(64)}`);
    expect(res.status).toBe(200);
    expect(res.body.licenseType).toBe("PerQuery");
    expect(res.body.licenseCount).toBe(1);
  });

  it("GET /api/datasets/:id/licenses summarizes licenses", async () => {
    const res = await request(app).get(`/api/datasets/${"a".repeat(64)}/licenses`);
    expect(res.status).toBe(200);
    expect(res.body.licenseCount).toBe(1);
    expect(res.body.totalRecordedUsage).toBe("3");
    expect(res.body.licenses[0].status).toBe("Active");
  });

  it("GET /api/licenses/:id returns 400 for a non-positive integer id", async () => {
    for (const bad of ["abc", "0", "-1", "1.5"]) {
      const res = await request(app).get(`/api/licenses/${bad}`);
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/positive integer/);
    }
  });

  it("GET /api/licenses/:id returns 404 for an unknown license", async () => {
    const res = await request(app).get("/api/licenses/999");
    expect(res.status).toBe(404);
    expect(res.body.error.message).toMatch(/License not found/);
  });
});
