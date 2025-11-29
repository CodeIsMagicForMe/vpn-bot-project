// src/workers/notification-worker.ts
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { config } from "../utils/config";
import { logger } from "../utils/logger";

const connection = new IORedis(config.redis.url);

export const notificationQueue = new Queue("notifications", {
  connection,
});

export const notificationWorker = new Worker(
  "notifications",
  async (job) => {
    // Phase 2: implement expiry reminders, etc.
    logger.info({ jobId: job.id, type: job.data.type }, "Notification job");
  },
  {
    connection,
    concurrency: 5,
    limiter: {
      max: 25,
      duration: 1000,
    },
  },
);

notificationWorker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, err }, "Notification job failed");
});
