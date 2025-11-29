// scripts/seed-db.ts
import { prisma } from "../src/db/prisma";
import { logger } from "../src/utils/logger";

async function main() {
  const tariffs = [
    {
      code: "TRIAL",
      name: "Trial",
      description: "Test drive for 1 day",
      durationDays: 1,
      priceStars: 0,
      allowedDevices: 1,
      isActive: true,
    },
    {
      code: "WEEK",
      name: "Week",
      description: "7 days access",
      durationDays: 7,
      priceStars: 100,
      allowedDevices: 1,
      isActive: true,
    },
    {
      code: "MONTH",
      name: "Month",
      description: "30 days access",
      durationDays: 30,
      priceStars: 400,
      allowedDevices: 1,
      isActive: true,
    },
    {
      code: "3MONTH",
      name: "3 Months",
      description: "90 days access",
      durationDays: 90,
      priceStars: 1000,
      allowedDevices: 2,
      isActive: true,
    },
  ];

  for (const t of tariffs) {
    await prisma.tariff.upsert({
      where: { code: t.code },
      update: {
        name: t.name,
        description: t.description,
        durationDays: t.durationDays,
        priceStars: t.priceStars,
        allowedDevices: t.allowedDevices,
        isActive: t.isActive,
      },
      create: t,
    });
  }

  logger.info("Tariffs seeded/updated");
}

main()
  .catch((err) => {
    logger.error({ err }, "Seed failed");
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

