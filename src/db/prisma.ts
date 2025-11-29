// src/db/prisma.ts
import { PrismaClient } from "@prisma/client";
import { logger } from "../utils/logger";

export const prisma = new PrismaClient({
  log: ["error", "warn"],
});

prisma
  .$connect()
  .then(() => logger.info("Prisma connected to database"))
  .catch((err) => {
    logger.error({ err }, "Failed to connect Prisma");
    process.exit(1);
  });

export type PrismaTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

