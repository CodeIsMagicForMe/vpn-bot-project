// src/utils/logger.ts
import pino from "pino";
import { config } from "./config";

const isProd = config.logging.environment === "production";

const logger = pino(
  isProd
    ? {
        level: config.logging.level,
      }
    : {
        level: config.logging.level,
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
          },
        },
      },
);

export { logger };
