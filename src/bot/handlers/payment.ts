// src/bot/handlers/payment.ts
import type { Bot } from "grammy";
import type { BotContext } from "../index";
import { prisma } from "../../db/prisma";
import { config } from "../../utils/config";
import { logger } from "../../utils/logger";
import { createOrExtendSubscription, PurchaseScenario } from "../../services/subscription";
import { vpnApi } from "../../services/vpn-api";
import { sendConfigsToUser } from "../../services/vpn-config";

function validateInvoicePayload(payload: string): boolean {
  // tariff_<id>_<timestamp>
  return /^tariff_\d+_\d+$/.test(payload);
}

export function registerPaymentHandlers(bot: Bot<BotContext>): void {
  // PRE-CHECKOUT: respond immediately (< 1 sec), no heavy work!
  bot.on("pre_checkout_query", async (ctx) => {
    const query = ctx.preCheckoutQuery;
    const isValid = validateInvoicePayload(query.invoice_payload);
    await ctx.answerPreCheckoutQuery(isValid, {
      error_message: isValid ? undefined : "Invalid payment data",
    });
  });

  // SUCCESSFUL PAYMENT: heavy processing here (DB + VPN API)
  bot.on("message:successful_payment", async (ctx) => {
    const from = ctx.from;
    const msg = ctx.message;
    if (!from || !msg || !msg.successful_payment) return;

    const sp = msg.successful_payment;
    const telegramId = BigInt(from.id);

    try {
      // Ensure user exists
      const user = await prisma.user.findUnique({
        where: { telegramId },
      });
      if (!user) {
        logger.error(
          { telegramId },
          "Successful payment from unknown user (no DB record)",
        );
        await ctx.reply("❌ Internal error: user not found. Please /start again.");
        return;
      }

      // Idempotency: check telegramPaymentChargeId
      const telegramPayloadId = sp.telegram_payment_charge_id;
      const existingPayment = await prisma.payment.findUnique({
        where: { telegramPayloadId },
      });

      if (existingPayment) {
        logger.info(
          { telegramPayloadId },
          "Duplicate successful_payment update, ignoring",
        );
        return;
      }

      // Parse tariffId from invoice payload
      const parts = sp.invoice_payload.split("_");
      const tariffId = Number(parts[1]);
      if (!tariffId) {
        await ctx.reply("❌ Invalid payment payload.");
        return;
      }

      // Create payment record
      const paymentRecord = await prisma.payment.create({
        data: {
          userId: user.id,
          tariffId,
          starsAmount: sp.total_amount,
          telegramPayloadId,
          status: "SUCCESS",
        },
      });

      // Create or extend subscription based on scenario
      const result = await createOrExtendSubscription(user.id, tariffId);
      const { subscription, scenario, tariffDurationDays, allowedDevices } =
        result;

      // For RENEW: do not create new configs, just confirm to user
      if (scenario === PurchaseScenario.RENEW) {
        await ctx.reply(
          "✅ Subscription renewed! Your existing VPN configs remain valid.",
        );
        return;
      }

      // For NEW_USER and simplified other scenarios: generate VPN configs now
      const vpnResp = await vpnApi.createConfigs({
        userId: user.id,
        subscriptionId: subscription.id,
        allowedDevices,
        durationDays: tariffDurationDays,
      });

      const configs = vpnResp.configs ?? [];

      // Save TWO configs (amneziawg + vless_reality)
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

      logger.info(
        {
          paymentId: paymentRecord.id,
          subscriptionId: subscription.id,
        },
        "Payment processed and configs generated",
      );
    } catch (err) {
      logger.error(
        { err, fromId: from.id },
        "Error handling successful_payment",
      );
      await ctx.reply(
        "❌ Error processing payment. Admin will contact you if payment was successful on your side.",
      );
    }
  });
}

