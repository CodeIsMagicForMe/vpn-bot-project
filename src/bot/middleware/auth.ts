// src/bot/middleware/auth.ts
import type { MiddlewareFn } from "grammy";
import type { BotContext } from "../index";
import { prisma } from "../../db/prisma";
import { logger } from "../../utils/logger";

export const authMiddleware: MiddlewareFn<BotContext> = async (ctx, next) => {
  if (!ctx.from) return next();

  const telegramId = BigInt(ctx.from.id);
  let user = await prisma.user.findUnique({ where: { telegramId } });

  if (!user) {
    user = await prisma.user.create({
      data: {
        telegramId,
        username: ctx.from.username || null,
        language: "ru",
      },
    });
    logger.info({ userId: user.id }, "User auto-registered from middleware");
  }

  if (user.isBlocked) {
    await ctx.reply("❌ You are blocked from using this bot.");
    return;
  }

  await next();
};

export function isAdmin(telegramId: number, adminIds: number[]): boolean {
  return adminIds.includes(telegramId);
}

