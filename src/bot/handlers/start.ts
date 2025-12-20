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
    [{ text: "🛍 Купить VPN" }, { text: "📲 Мой VPN" }],
    [{ text: "🎁 Пробный период" }],
    [{ text: "🤝 Пригласить друга" }, { text: "⚙️ Настройки" }],
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
      "👋 Добро пожаловать!\n\nИспользуйте кнопки меню: купить VPN, получить конфиги или активировать пробный период.",
      { reply_markup: MAIN_MENU },
    );
  });

  // Text handlers for main menu
  bot.hears("🛍 Купить VPN", showTariffs);
  bot.hears("📲 Мой VPN", handleMyVpn);
  bot.hears("🎁 Пробный период", handleTrial);
  bot.hears("🤝 Пригласить друга", handleInviteFriend);
  bot.hears("⚙️ Настройки", async (ctx) => {
    await ctx.reply("Настройки будут доступны позже.");
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
    await ctx.reply("Тарифы пока не настроены.");
    return;
  }

  const lines = tariffs.map(
    (t: any) => `${t.name} | ${t.priceStars} ⭐ (${t.durationDays} дней)`,
  );

  await ctx.reply("Доступные тарифы:\n\n" + lines.join("\n"), {
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
    await ctx.reply("Тариф недоступен.");
    return;
  }

  // Invoice payload: tariff_<id>_<timestamp>
  const payload = `tariff_${tariff.id}_${Date.now()}`;

  await ctx.replyWithInvoice(
    `${tariff.name} — подписка VPN`,
    `${tariff.durationDays} дней доступа к VPN`,
    payload,
    "XTR", // Telegram Stars
    [
      {
        label: "Подписка VPN",
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
    await ctx.reply("Пожалуйста, сначала отправьте /start.");
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
    await ctx.reply("У вас нет активной подписки.", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🛍 Купить VPN", callback_data: "show_tariffs" }],
        ],
      },
    });
    return;
  }

  const tariffName = subscription.tariff?.name || "Пробный";
  const msLeft = subscription.endAt.getTime() - Date.now();
  const daysLeft = Math.max(0, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));

  await ctx.reply(
    `📱 Статус VPN:\n\n` +
      `Тариф: ${tariffName}\n` +
      `Осталось дней: ${daysLeft}\n` +
      `Устройств: ${subscription.allowedDevices}\n`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📋 Получить конфиги", callback_data: "get_configs" }],
          [{ text: "🔄 Продлить", callback_data: "show_tariffs" }],
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
    await ctx.reply("Пожалуйста, сначала отправьте /start.");
    return;
  }

  if (user.hasTrialUsed) {
    await ctx.reply("❌ Вы уже использовали пробный период.");
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
    await ctx.reply("❌ У вас уже есть активная подписка.");
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
      "❌ Ошибка при создании тестовых конфигов. Администратор свяжется с вами.",
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
    await ctx.reply("Пожалуйста, сначала отправьте /start.");
    return;
  }

  const refLink = `https://t.me/${config.telegram.username}?start=ref_${user.id}`;
  await ctx.reply(
    `🎁 Ваша реферальная ссылка:\n\n${refLink}\n\n` +
      `Во 2-й фазе приглашённые друзья будут автоматически добавлять вам бонусные дни.`,
  );
}
