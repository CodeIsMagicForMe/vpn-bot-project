// src/index.ts
import express from "express";
import { bot, initBot } from "./bot";
import { config } from "./utils/config";
import { logger } from "./utils/logger";

const app = express();

app.use(express.json());

// Telegram webhook endpoint
app.post("/webhook", async (req, res) => {
  const secret = req.headers["x-telegram-bot-api-secret-token"];
  if (secret !== config.telegram.webhookSecret) {
    logger.warn("Invalid webhook secret token");
    return res.status(403).send("Forbidden");
  }

  // Always respond quickly to avoid timeouts
  res.status(200).send("OK");

  // Process update asynchronously
  bot
    .handleUpdate(req.body)
    .catch((err) =>
      logger.error({ err, update: req.body }, "Failed to process update"),
    );
});

// Health check
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

const port = config.app.port;

app.listen(port, async () => {
  await initBot();
  logger.info(`Webhook server listening on port ${port}`);
});
