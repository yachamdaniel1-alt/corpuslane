import { Router } from "express";
import type { PrismaClient } from "@prisma/client";

export function healthRoute(prisma: PrismaClient): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    const check: Record<string, string> = { status: "ok" };
    try {
      await prisma.$queryRaw`SELECT 1`;
      check.database = "ok";
    } catch (err) {
      check.database = "unreachable";
      check.status = "degraded";
    }
    res.json(check);
  });

  return router;
}