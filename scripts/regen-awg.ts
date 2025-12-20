// scripts/regen-awg.ts
import "dotenv/config";
import { prisma } from "../src/db/prisma";
import { vpnApi } from "../src/services/vpn-api";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const isAll = process.argv.includes("--all");
const telegram = arg("--telegram"); // Telegram user id (число)
const force = process.argv.includes("--force"); // если надо перевыпустить даже при наличии AWG

async function main() {
  const now = new Date();

  let subs = [];

  if (telegram) {
    const user = await prisma.user.findUnique({
      where: { telegramId: BigInt(telegram) },
    });
    if (!user) throw new Error(`User not found for telegramId=${telegram}`);

    subs = await prisma.subscription.findMany({
      where: { userId: user.id, status: "ACTIVE", endAt: { gt: now } },
      orderBy: { endAt: "desc" },
    });
  } else if (isAll) {
    subs = await prisma.subscription.findMany({
      where: { status: "ACTIVE", endAt: { gt: now } },
      orderBy: { endAt: "asc" },
    });
  } else {
    console.log("Usage:");
    console.log("  npx ts-node scripts/regen-awg.ts --telegram 123456789");
    console.log("  npx ts-node scripts/regen-awg.ts --all");
    console.log("Options:");
    console.log("  --force   regenerate even if amneziawg exists");
    process.exit(0);
  }

  console.log(`Found ${subs.length} active subscription(s).`);

  for (const sub of subs) {
    const durationDays = Math.max(
      1,
      Math.ceil((sub.endAt.getTime() - Date.now()) / 86400000),
    );

    const existingAwg = await prisma.vpnConfig.findFirst({
      where: {
        userId: sub.userId,
        subscriptionId: sub.id,
        revokedAt: null,
        protocolType: "amneziawg",
      },
    });

    if (existingAwg && !force) {
      console.log(
        `SKIP sub=${sub.id} user=${sub.userId} (amneziawg already exists). Use --force to regenerate.`,
      );
      continue;
    }

    console.log(`Regen sub=${sub.id} user=${sub.userId} daysLeft=${durationDays}...`);

    // 1) revoke старый WG (если он был)
    await prisma.vpnConfig.updateMany({
      where: {
        userId: sub.userId,
        subscriptionId: sub.id,
        revokedAt: null,
        protocolType: { in: ["wireguard", "wg"] },
      },
      data: { revokedAt: new Date() },
    });

    // если форсим — отзываем старый awg, чтобы остался один актуальный
    if (force) {
      await prisma.vpnConfig.updateMany({
        where: {
          userId: sub.userId,
          subscriptionId: sub.id,
          revokedAt: null,
          protocolType: "amneziawg",
        },
        data: { revokedAt: new Date() },
      });
    }

    // 2) запрос к vpn-api
    const resp = await vpnApi.createConfigs({
      userId: sub.userId,
      subscriptionId: sub.id,
      allowedDevices: sub.allowedDevices,
      durationDays,
    });

    const configs = resp.configs ?? [];
    const vless = configs.find((c) => c.protocol === "vless_reality");
    const awg = configs.find((c) => c.protocol === "amneziawg");

    if (!vless || !awg) {
      throw new Error(
        `vpn-api did not return both configs for sub=${sub.id}. Got: ${configs
          .map((c) => c.protocol)
          .join(", ")}`,
      );
    }

    // 3) сохранить VLESS (upsert по externalId)
    await prisma.vpnConfig.upsert({
      where: { externalId: vless.config_id },
      create: {
        userId: sub.userId,
        subscriptionId: sub.id,
        externalId: vless.config_id,
        protocolType: vless.protocol,
        configText: Buffer.from(vless.config_text, "utf8"),
        qrData: vless.qr_data ?? null,
      },
      update: {
        revokedAt: null,
        protocolType: vless.protocol,
        configText: Buffer.from(vless.config_text, "utf8"),
        qrData: vless.qr_data ?? null,
      },
    });

    // 4) сохранить AWG (новый externalId каждый раз)
    await prisma.vpnConfig.create({
      data: {
        userId: sub.userId,
        subscriptionId: sub.id,
        externalId: awg.config_id,
        protocolType: awg.protocol,
        configText: Buffer.from(awg.config_text, "utf8"),
        qrData: awg.qr_data ?? null,
      },
    });

    console.log(`OK sub=${sub.id} user=${sub.userId}: saved vless + awg`);
  }

  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
