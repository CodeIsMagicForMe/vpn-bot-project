// src/bot/index.ts
import { Bot, Context, session, SessionFlavor } from "grammy";
import { RedisAdapter } from "@grammyjs/storage-redis";
import IORedis from "ioredis";
import { config } from "../utils/config";
import { logger } from "../utils/logger";
import { registerStartHandlers } from "./handlers/start";
import { registerPaymentHandlers } from "./handlers/payment";
import { registerAdminHandlers } from "./handlers/admin";
import { authMiddleware } from "./middleware/auth";
import { loggingMiddleware } from "./middleware/logging";

export interface SessionData {
  state?: string; // FSM-like state for future Phase 2
  data?: Record<string, unknown>;
}

export type BotContext = Context & SessionFlavor<SessionData>;

export const bot = new Bot<BotContext>(config.telegram.token);

function createSessionStorage() {
  if (config.app.env === "production") {
    const redis = new IORedis(config.redis.url);
    const storage = new RedisAdapter({ instance: redis });
    logger.info("Using Redis session storage");
    return storage;
  }
  logger.info("Using in-memory session storage (dev only)");
  return undefined;
}

bot.use(
  session({
    initial: () => ({
      state: undefined,
      data: {},
    }),
    storage: createSessionStorage(),
  }),
);

bot.use(loggingMiddleware);
bot.use(authMiddleware);

// Handlers
registerStartHandlers(bot);
registerPaymentHandlers(bot);
registerAdminHandlers(bot);

bot.catch((err) => {
  logger.error({ err }, "Error in bot flow");
});

export async function initBot(): Promise<void> {
  // инициализируем botInfo у grammy
  await bot.init();

  logger.info("Bot initialized");
}


