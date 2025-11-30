// src/db/prisma.ts
import { PrismaClient } from "@prisma/client";
import { logger } from "../utils/logger";

export const prisma = new PrismaClient({
  log: ["error", "warn"],
});

prisma
  .$connect()
  .then(() => logger.info("Prisma connected to database"))
  .catch((err: unknown) => {
    logger.error({ err }, "Failed to connect Prisma");
    process.exit(1);
  });

// Если понадобится транзакционный client, можно будет добавить тип позже
// export type PrismaTx = PrismaClient;
