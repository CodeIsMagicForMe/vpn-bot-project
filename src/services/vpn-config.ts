// src/services/vpn-config.ts
import { InputFile } from "grammy";
import type { VpnConfigItem } from "./vpn-api";
import type { BotContext } from "../bot";
import { prisma } from "../db/prisma";

export async function sendConfigsToUser(
  ctx: BotContext,
  configs: VpnConfigItem[],
): Promise<void> {
  if (!configs.length) {
    await ctx.reply("❌ No VPN configs available");
    return;
  }

  const lines = configs.map((cfg: VpnConfigItem) => {
    const icon = cfg.protocol === "amneziawg" ? "🚀" : "🛡";
    return `${icon} ${cfg.protocol.toUpperCase()}\n<code>${cfg.config_text}</code>`;
  });

  await ctx.reply(`✅ Your VPN configs:\n\n${lines.join("\n\n")}`, {
    parse_mode: "HTML",
  });

  for (const cfg of configs) {
    if (!cfg.qr_data) continue;

    // qr_data приходит как data:image/png;base64,...
    const [, base64] = cfg.qr_data.split(",");
    if (!base64) continue;
    const buffer = Buffer.from(base64, "base64");

    await ctx.replyWithPhoto(new InputFile(buffer), {
      caption: `QR Code: ${cfg.protocol.toUpperCase()}`,
    });
  }
}

/**
 * Утилита для выдачи уже сохранённых конфигов из БД (по активной подписке).
 */
export async function sendExistingConfigsForActiveSubscription(
  ctx: BotContext,
  userId: number,
): Promise<void> {
  const activeSub = await prisma.subscription.findFirst({
    where: {
      userId,
      status: "ACTIVE",
      endAt: { gt: new Date() },
    },
    orderBy: { endAt: "desc" },
  });

  if (!activeSub) {
    await ctx.reply("You have no active subscription.");
    return;
  }

  const configs = await prisma.vpnConfig.findMany({
    where: {
      userId,
      subscriptionId: activeSub.id,
      revokedAt: null,
    },
  });

  if (!configs.length) {
    await ctx.reply("No configs stored for your active subscription yet.");
    return;
  }

  await ctx.reply(
    `✅ Your stored VPN configs:\n\n` +
      configs
        .map((cfg: any) => {
          const icon = cfg.protocolType === "amneziawg" ? "🚀" : "🛡";
          return `${icon} ${cfg.protocolType.toUpperCase()}\n<code>${Buffer.from(
            cfg.configText,
          ).toString("utf8")}</code>`;
        })
        .join("\n\n"),
    { parse_mode: "HTML" },
  );
}
