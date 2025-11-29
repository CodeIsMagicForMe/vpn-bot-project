// src/bot/middleware/logging.ts
import type { MiddlewareFn } from "grammy";
import type { BotContext } from "../index";
import { logger } from "../../utils/logger";

export const loggingMiddleware: MiddlewareFn<BotContext> = async (
  ctx,
  next,
) => {
  const from = ctx.from;
  logger.info(
    {
      fromId: from?.id,
      username: from?.username,
      updateType: ctx.update.update_id,
    },
    "Incoming update",
  );
  await next();
};

