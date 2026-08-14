import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { HttpError } from "../middleware/errorHandler";

/**
 * GET /api/licenses/:id
 *
 * Returns the license with its full usage / settlement / revocation history.
 */
export function licenseRoutes(prisma: PrismaClient): Router {
  const router = Router();

  router.get("/:id", async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        throw new HttpError(400, "License id must be a positive integer");
      }

      const license = await prisma.license.findUnique({
        where: { id },
        include: {
          dataset: true,
          usageRecords: { orderBy: { recordedAt: "asc" } },
          settlements: { orderBy: { settledAt: "asc" } },
          revocation: true,
        },
      });
      if (!license) {
        throw new HttpError(404, `License not found: ${id}`);
      }

      res.json({
        id: license.id,
        dataset: {
          id: license.dataset.id,
          owner: license.dataset.owner,
          metadataHash: license.dataset.metadataHash,
          licenseType: license.dataset.licenseType,
          price: license.dataset.price,
          epochSeconds: license.dataset.epochSeconds,
        },
        licensee: license.licensee,
        token: license.token,
        termsType: license.termsType,
        price: license.price,
        epochSeconds: license.epochSeconds,
        status: license.status,
        purchasedAt: license.purchasedAt,
        usageCount: license.usageCount.toString(),
        payable: license.payable,
        settledTotal: license.settledTotal,
        lastSettleTs: license.lastSettleTs.toString(),
        usageRecords: license.usageRecords.map((u) => ({
          reporter: u.reporter,
          usageCount: u.usageCount.toString(),
          delta: u.delta,
          recordedAt: u.recordedAt,
          ledgerSeq: u.ledgerSeq,
          txHash: u.txHash,
        })),
        settlements: license.settlements.map((s) => ({
          amount: s.amount,
          caller: s.caller,
          settledAt: s.settledAt,
          ledgerSeq: s.ledgerSeq,
          txHash: s.txHash,
        })),
        revocation: license.revocation
          ? {
              revokedBy: license.revocation.revokedBy,
              revokedAt: license.revocation.revokedAt,
              ledgerSeq: license.revocation.ledgerSeq,
              txHash: license.revocation.txHash,
            }
          : null,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}