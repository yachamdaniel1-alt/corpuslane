import express from "express";
import pinoHttp from "pino-http";
import pino from "pino";
import cors from "cors";
import { prisma } from "./db/client";
import { datasetRoutes } from "./routes/datasets";
import { licenseRoutes } from "./routes/licenses";
import { healthRoute } from "./routes/health";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

const logger = pino({ level: process.env.LOG_LEVEL || "info" });
const app = express();

app.use(pinoHttp({ logger }));
app.use(
  cors({
    origin: process.env.CORS_ALLOWED_ORIGIN
      ? process.env.CORS_ALLOWED_ORIGIN.split(",").map((o) => o.trim())
      : ["http://localhost:3000", "http://127.0.0.1:3000"],
    credentials: false,
  })
);
app.use(express.json());

app.use("/api/datasets", datasetRoutes(prisma));
app.use("/api/licenses", licenseRoutes(prisma));
app.use("/health", healthRoute(prisma));

app.use(notFoundHandler);
app.use(errorHandler);

const PORT = parseInt(process.env.PORT || "3001", 10);

async function main(): Promise<void> {
  await prisma.$connect();
  logger.info("Connected to database");
  app.listen(PORT, () => {
    logger.info({ port: PORT }, "Corpuslane backend listening");
  });
}

main().catch((err) => {
  logger.error(err, "Failed to start server");
  process.exit(1);
});

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  process.exit(0);
});