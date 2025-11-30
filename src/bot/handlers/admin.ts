// src/bot/handlers/admin.ts
import type { Bot } from "grammy";
import type { BotContext } from "../index";
import { prisma } from "../../db/prisma";
import { config } from "../../utils/config";
import { isAdmin } from "../middleware/auth";

export function registerAdminHandlers(bot: Bot<BotContext>): void {
  bot.command("stats", async (ctx) => {
    if (!ctx.from || !isAdmin(ctx.from.id, config.telegram.adminIds)) {
      return ctx.reply("Access denied");
    }

    const [totalUsers, activeSubscriptions, revenue] = await Promise.all([
      prisma.user.count(),
      prisma.subscription.count({
        where: { status: "ACTIVE", endAt: { gt: new Date() } },
      }),
      prisma.payment.aggregate({
        _sum: { starsAmount: true },
      }),
    ]);

    await ctx.reply(
      `📊 Bot Stats:\n\n` +
        `Total Users: ${totalUsers}\n` +
        `Active Subscriptions: ${activeSubscriptions}\n` +
        `Total Revenue: ${revenue._sum.starsAmount || 0} ⭐`,
    );
  });

  bot.command("user", async (ctx) => {
    if (!ctx.from || !isAdmin(ctx.from.id, config.telegram.adminIds)) {
      return ctx.reply("Access denied");
    }

    const parts = ctx.message?.text?.split(" ") ?? [];
    const tgIdStr = parts[1];
    const tgId = Number(tgIdStr);
    if (!tgId) {
      await ctx.reply("Usage: /user <telegram_id>");
      return;
    }

    const user = await prisma.user.findUnique({
      where: { telegramId: BigInt(tgId) },
      include: {
        subscriptions: true,
        payments: true,
      },
    });

    if (!user) {
      await ctx.reply("User not found");
      return;
    }

    const activeSubs = user.subscriptions.filter((s: any) => {
      return s.status === "ACTIVE" && s.endAt > new Date();
    });

    await ctx.reply(
      `👤 User Info:\n\n` +
        `ID: ${user.id}\n` +
        `Telegram: ${tgId}\n` +
        `Username: @${user.username || "unknown"}\n` +
        `Registered: ${user.registeredAt.toISOString()}\n` +
        `Active Subscriptions: ${activeSubs.length}\n` +
        `Payments: ${user.payments.length}\n` +
        `Blocked: ${user.isBlocked ? "yes" : "no"}`,
    );
  });

  bot.command("block_user", async (ctx) => {
    if (!ctx.from || !isAdmin(ctx.from.id, config.telegram.adminIds)) {
      return ctx.reply("Access denied");
    }

    const parts = ctx.message?.text?.split(" ") ?? [];
    const tgIdStr = parts[1];
    const tgId = Number(tgIdStr);
    if (!tgId) {
      await ctx.reply("Usage: /block_user <telegram_id>");
      return;
    }

    const user = await prisma.user.findUnique({
      where: { telegramId: BigInt(tgId) },
    });

    if (!user) {
      await ctx.reply("User not found");
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { isBlocked: true },
    });

    await prisma.subscription.updateMany({
      where: {
        userId: user.id,
        status: "ACTIVE",
      },
      data: {
        status: "CANCELLED",
        statusReason: "User blocked",
      },
    });

    await ctx.reply(`✅ User ${tgId} blocked, active subscriptions cancelled`);
  });
}
