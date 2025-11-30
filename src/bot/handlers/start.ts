// src/bot/handlers/start.ts
import type { Bot } from "grammy";
import type { BotContext } from "../index";
import { prisma } from "../../db/prisma";
import { config } from "../../utils/config";
import { vpnApi } from "../../services/vpn-api";
import {
  sendConfigsToUser,
  sendExistingConfigsForActiveSubscription,
} from "../../services/vpn-config";
import { logger } from "../../utils/logger";

const MAIN_MENU = {
  keyboard: [
    [{ text: "🛍 Buy VPN" }, { text: "📲 My VPN" }],
    [{ text: "🎁 Trial subscription" }],
    [{ text: "🤝 Invite friend" }, { text: "⚙️ Settings" }],
  ],
  resize_keyboard: true,
};

export function registerStartHandlers(bot: Bot<BotContext>): void {
  bot.command("start", async (ctx) => {
    const from = ctx.from;
    if (!from) return;

    const telegramId = BigInt(from.id);

    // Referral param: /start ref_123
    const args = ctx.match as string | undefined;
    let invitedById: number | undefined;

    if (typeof args === "string" && args.startsWith("ref_")) {
      const refId = Number(args.replace("ref_", ""));
      if (!Number.isNaN(refId)) {
        invitedById = refId;
      }
    }

    let user = await prisma.user.findUnique({ where: { telegramId } });

    if (!user) {
      user = await prisma.user.create({
        data: {
          telegramId,
          username: from.username || null,
          language: "ru",
          invitedById: invitedById ?? null,
        },
      });
    } else if (!user.invitedById && invitedById) {
      await prisma.user.update({
        where: { id: user.id },
        data: { invitedById },
      });
    }

    await ctx.reply(
      "👋 Welcome to VPN bot!\n\nUse menu buttons to buy VPN, get configs or start a trial.",
      { reply_markup: MAIN_MENU },
    );
  });

  // Text handlers for main menu
  bot.hears("🛍 Buy VPN", showTariffs);
  bot.hears("📲 My VPN", handleMyVpn);
  bot.hears("🎁 Trial subscription", handleTrial);
  bot.hears("🤝 Invite friend", handleInviteFriend);
  bot.hears("⚙️ Settings", async (ctx) => {
    await ctx.reply("Settings will be available later.");
  });

  // Tariff selection via callback_data: tariff:<id>
  bot.callbackQuery(/^tariff:(\d+)$/, async (ctx) => {
    const match = ctx.match as RegExpMatchArray;
    const tariffId = Number(match[1]);
    await ctx.answerCallbackQuery();
    await handleTariffSelection(ctx, tariffId);
  });

  bot.callbackQuery("show_tariffs", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showTariffs(ctx);
  });

  bot.callbackQuery("get_configs", async (ctx) => {
    await ctx.answerCallbackQuery();
    const from = ctx.from;
    if (!from) return;
    const user = await prisma.user.findUnique({
      where: { telegramId: BigInt(from.id) },
    });
    if (!user) return;
    await sendExistingConfigsForActiveSubscription(ctx, user.id);
  });
}

async function showTariffs(ctx: BotContext): Promise<void> {
  const tariffs = await prisma.tariff.findMany({
    where: { isActive: true, code: { not: "TRIAL" } },
    orderBy: { priceStars: "asc" },
  });

  if (!tariffs.length) {
    await ctx.reply("No tariffs configured yet.");
    return;
  }

  const lines = tariffs.map(
    (t: any) => `${t.name} | ${t.priceStars} ⭐ (${t.durationDays} days)`,
  );

  await ctx.reply("Available tariffs:\n\n" + lines.join("\n"), {
    reply_markup: {
      inline_keyboard: tariffs.map((t: any) => [
        {
          text: `${t.name} | ${t.priceStars} ⭐`,
          callback_data: `tariff:${t.id}`,
        },
      ]),
    },
  });
}

async function handleTariffSelection(
  ctx: BotContext,
  tariffId: number,
): Promise<void> {
  const tariff = await prisma.tariff.findUnique({
    where: { id: tariffId },
  });

  if (!tariff || !tariff.isActive) {
    await ctx.reply("Tariff not available.");
    return;
  }

  // Invoice payload: tariff_<id>_<timestamp>
  const payload = `tariff_${tariff.id}_${Date.now()}`;

  await ctx.replyWithInvoice(
    `${tariff.name} VPN Subscription`,
    `${tariff.durationDays} days access to VPN`,
    payload,
    "XTR", // Telegram Stars
    [
      {
        label: "VPN Subscription",
        amount: tariff.priceStars,
      },
    ],
  );
}

async function handleMyVpn(ctx: BotContext): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(from.id) },
  });

  if (!user) {
    await ctx.reply("Please send /start first.");
    return;
  }

  const subscription = await prisma.subscription.findFirst({
    where: {
      userId: user.id,
      status: "ACTIVE",
      endAt: { gt: new Date() },
    },
    orderBy: { endAt: "desc" },
    include: { tariff: true },
  });

  if (!subscription) {
    await ctx.reply("You have no active subscription.", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🛍 Buy VPN", callback_data: "show_tariffs" }],
        ],
      },
    });
    return;
  }

  const tariffName = subscription.tariff?.name || "Trial";
  const msLeft = subscription.endAt.getTime() - Date.now();
  const daysLeft = Math.max(0, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));

  await ctx.reply(
    `📱 Your VPN Status:\n\n` +
      `Plan: ${tariffName}\n` +
      `Days left: ${daysLeft}\n` +
      `Devices: ${subscription.allowedDevices}\n`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📋 Get Configs", callback_data: "get_configs" }],
          [{ text: "🔄 Renew", callback_data: "show_tariffs" }],
        ],
      },
    },
  );
}

async function handleTrial(ctx: BotContext): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(from.id) },
  });

  if (!user) {
    await ctx.reply("Please send /start first.");
    return;
  }

  if (user.hasTrialUsed) {
    await ctx.reply("❌ You already used your trial.");
    return;
  }

  const activeSubscription = await prisma.subscription.findFirst({
    where: {
      userId: user.id,
      status: "ACTIVE",
      endAt: { gt: new Date() },
    },
  });

  if (activeSubscription) {
    await ctx.reply("❌ You already have an active subscription.");
    return;
  }

  const now = new Date();
  const trialDays = config.features.trialDays || 1;
  const end = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);

  const subscription = await prisma.subscription.create({
    data: {
      userId: user.id,
      tariffId: null,
      type: "TRIAL",
      startAt: now,
      endAt: end,
      status: "ACTIVE",
      allowedDevices: 1,
    },
  });

  try {
    const vpnResp = await vpnApi.createConfigs({
      userId: user.id,
      subscriptionId: subscription.id,
      allowedDevices: 1,
      durationDays: trialDays,
    });

    const configs = vpnResp.configs ?? [];

    await prisma.vpnConfig.createMany({
      data: configs.map((cfg) => ({
        userId: user.id,
        subscriptionId: subscription.id,
        externalId: cfg.config_id,
        protocolType: cfg.protocol,
        configText: Buffer.from(cfg.config_text, "utf8"),
        qrData: cfg.qr_data || null,
      })),
    });

    await sendConfigsToUser(ctx, configs);
    await prisma.user.update({
      where: { id: user.id },
      data: { hasTrialUsed: true },
    });
  } catch (err) {
    logger.error({ err }, "Trial config generation failed");
    await ctx.reply(
      "❌ Error creating trial configs. Admin will contact you.",
    );
  }
}

async function handleInviteFriend(ctx: BotContext): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(from.id) },
  });

  if (!user) {
    await ctx.reply("Please send /start first.");
    return;
  }

  const refLink = `https://t.me/${config.telegram.username}?start=ref_${user.id}`;
  await ctx.reply(
    `🎁 Share your referral link:\n\n${refLink}\n\n` +
      `In Phase 2 your friends will grant you bonus days automatically.`,
  );
}
