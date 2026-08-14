import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { HttpError } from "../middleware/errorHandler";

const listQuerySchema = z.object({
  owner: z.string().optional(),
  licenseType: z.enum(["Flat", "PerQuery", "PerEpoch"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export function datasetRoutes(prisma: PrismaClient): Router {
  const router = Router();

  // GET /api/datasets
  router.get("/", async (req, res, next) => {
    try {
      const parsed = listQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw new HttpError(400, "Invalid query parameters", parsed.error.flatten().fieldErrors);
      }
      const { owner, licenseType, limit, offset } = parsed.data;

      const [rows, total] = await Promise.all([
        prisma.dataset.findMany({
          where: {
            ...(owner ? { owner } : {}),
            ...(licenseType ? { licenseType } : {}),
          },
          include: { _count: { select: { licenses: true } } },
          orderBy: { registeredAt: "desc" },
          take: limit,
          skip: offset,
        }),
        prisma.dataset.count({
          where: {
            ...(owner ? { owner } : {}),
            ...(licenseType ? { licenseType } : {}),
          },
        }),
      ]);

      res.json({
        datasets: rows.map((d) => ({
          id: d.id,
          owner: d.owner,
          metadataHash: d.metadataHash,
          licenseType: d.licenseType,
          price: d.price,
          epochSeconds: d.epochSeconds,
          registeredAt: d.registeredAt,
          licenseCount: d._count.licenses,
          ledgerSeq: d.ledgerSeq,
          txHash: d.txHash,
        })),
        pagination: { limit, offset, total },
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/datasets/:id
  router.get("/:id", async (req, res, next) => {
    try {
      const dataset = await prisma.dataset.findUnique({
        where: { id: req.params.id },
        include: { _count: { select: { licenses: true } } },
      });
      if (!dataset) {
        throw new HttpError(404, `Dataset not found: ${req.params.id}`);
      }
      res.json({
        id: dataset.id,
        owner: dataset.owner,
        metadataHash: dataset.metadataHash,
        licenseType: dataset.licenseType,
        price: dataset.price,
        epochSeconds: dataset.epochSeconds,
        registeredAt: dataset.registeredAt,
        licenseCount: dataset._count.licenses,
        ledgerSeq: dataset.ledgerSeq ?? null,
        txHash: dataset.txHash ?? null,
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/datasets/:id/licenses
  router.get("/:id/licenses", async (req, res, next) => {
    try {
      const dataset = await prisma.dataset.findUnique({ where: { id: req.params.id } });
      if (!dataset) {
        throw new HttpError(404, `Dataset not found: ${req.params.id}`);
      }
      const licenses = await prisma.license.findMany({
        where: { datasetId: req.params.id },
        orderBy: { purchasedAt: "desc" },
      });
      const summary = await prisma.license.aggregate({
        where: { datasetId: req.params.id },
        _sum: { usageCount: true },
      });
      res.json({
        datasetId: req.params.id,
        licenseCount: licenses.length,
        totalRecordedUsage: summary._sum.usageCount?.toString() ?? "0",
        licenses: licenses.map((l) => ({
          id: l.id,
          licensee: l.licensee,
          token: l.token,
          termsType: l.termsType,
          price: l.price,
          epochSeconds: l.epochSeconds,
          status: l.status,
          purchasedAt: l.purchasedAt,
          usageCount: l.usageCount.toString(),
          payable: l.payable,
          settledTotal: l.settledTotal,
          revocation: null,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}