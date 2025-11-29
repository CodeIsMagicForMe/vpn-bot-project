// src/utils/config.ts
import dotenv from "dotenv";
import path from "path";

dotenv.config({
  path: path.resolve(process.cwd(), ".env"),
});

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  telegram: {
    token: required("TELEGRAM_BOT_TOKEN"),
    webhookUrl: process.env.TELEGRAM_WEBHOOK_URL,
    webhookSecret: required("TELEGRAM_WEBHOOK_SECRET"),
    adminIds: (process.env.TELEGRAM_ADMIN_IDS || "")
      .split(",")
      .filter(Boolean)
      .map((id) => Number(id.trim())),
    channelId: Number(process.env.TELEGRAM_CHANNEL_ID || 0),
    username: process.env.TELEGRAM_BOT_USERNAME || "",
  },
  database: {
    url: required("DATABASE_URL"),
    poolSize: Number(process.env.DATABASE_POOL_SIZE || 20),
  },
  redis: {
    url: process.env.REDIS_URL || "redis://localhost:6379/0",
  },
  vpnApi: {
    url: required("VPN_API_URL"),
    tokenPrimary: required("VPN_API_TOKEN_PRIMARY"),
    tokenSecondary: process.env.VPN_API_TOKEN_SECONDARY || "",
    timeout: Number(process.env.VPN_API_TIMEOUT || 15000),
  },
  security: {
    encryptionKey: required("ENCRYPTION_KEY"),
    jwtSecret: required("JWT_SECRET"),
    bcryptRounds: Number(process.env.BCRYPT_ROUNDS || 10),
  },
  features: {
    trialDays: Number(process.env.TRIAL_DURATION_DAYS || 1),
    referralDays: Number(process.env.REFERRAL_REWARD_DAYS || 3),
    gracePeriodHours: Number(process.env.GRACE_PERIOD_HOURS || 24),
    notificationCheckIntervalHours: Number(
      process.env.NOTIFICATION_CHECK_INTERVAL_HOURS || 1,
    ),
  },
  limits: {
    maxRequestsPerMinute: Number(process.env.MAX_REQUESTS_PER_MINUTE || 100),
    broadcastRateLimit: Number(process.env.BROADCAST_RATE_LIMIT || 25),
    webhookTimeoutMs: Number(process.env.WEBHOOK_TIMEOUT || 5000),
  },
  logging: {
    level: process.env.LOG_LEVEL || "info",
    environment: process.env.NODE_ENV || "development",
  },
  app: {
    port: Number(process.env.PORT || 3000),
    env: process.env.NODE_ENV || "development",
  },
};
