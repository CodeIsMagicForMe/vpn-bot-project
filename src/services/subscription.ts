// src/services/subscription.ts
import { prisma } from "../db/prisma";
import { AppError } from "../utils/errors";

export enum SubscriptionStatus {
  ACTIVE = "ACTIVE",
  EXPIRING_SOON = "EXPIRING_SOON",
  EXPIRED = "EXPIRED",
  CANCELLED = "CANCELLED",
  SUSPENDED = "SUSPENDED",
}

export enum SubscriptionType {
  TRIAL = "TRIAL",
  PAID = "PAID",
  BONUS = "BONUS",
  EXTENDED = "EXTENDED",
}

export enum PurchaseScenario {
  NEW_USER = "new_user",
  RENEW = "renew",
  UPGRADE = "upgrade",
  DOWNGRADE = "downgrade",
  EXTEND = "extend",
  CROSS_PURCHASE = "cross_purchase",
}

export async function determinePurchaseScenario(
  userId: number,
  newTariffId: number,
): Promise<PurchaseScenario> {
  const activeSubscription = await prisma.subscription.findFirst({
    where: {
      userId,
      status: SubscriptionStatus.ACTIVE,
      endAt: { gt: new Date() },
    },
    orderBy: { endAt: "desc" },
    include: { tariff: true },
  });

  // Нет активной подписки → новая покупка
  if (!activeSubscription) {
    return PurchaseScenario.NEW_USER;
  }

  const oldTariff = activeSubscription.tariff;
  const newTariff = await prisma.tariff.findUnique({
    where: { id: newTariffId },
  });

  if (!newTariff || !oldTariff) {
    throw new AppError("Tariff not found", { code: "TARIFF_NOT_FOUND" });
  }

  if (oldTariff.id === newTariff.id) {
    return PurchaseScenario.RENEW;
  }

  if (newTariff.priceStars > oldTariff.priceStars) {
    return PurchaseScenario.UPGRADE;
  }

  if (newTariff.priceStars < oldTariff.priceStars) {
    return PurchaseScenario.DOWNGRADE;
  }

  return PurchaseScenario.CROSS_PURCHASE;
}

export interface CreateOrExtendResult {
  scenario: PurchaseScenario;
  subscription: Awaited<ReturnType<typeof prisma.subscription.create>>;
  tariffDurationDays: number;
  allowedDevices: number;
}

/**
 * Phase 1: реализуем NEW_USER и RENEW.
 * Для остальных сценариев пока создаём новую подписку, помечая старую CANCELLED.
 */
export async function createOrExtendSubscription(
  userId: number,
  tariffId: number,
): Promise<CreateOrExtendResult> {
  const scenario = await determinePurchaseScenario(userId, tariffId);

  const tariff = await prisma.tariff.findUnique({
    where: { id: tariffId },
  });

  if (!tariff || !tariff.isActive) {
    throw new AppError("Tariff is not available", {
      code: "TARIFF_INACTIVE",
    });
  }

  const now = new Date();
  const durationMs = tariff.durationDays * 24 * 60 * 60 * 1000;

  const activeSubscription = await prisma.subscription.findFirst({
    where: {
      userId,
      status: SubscriptionStatus.ACTIVE,
      endAt: { gt: now },
    },
    orderBy: { endAt: "desc" },
  });

  if (scenario === PurchaseScenario.NEW_USER || !activeSubscription) {
    const subscription = await prisma.subscription.create({
      data: {
        userId,
        tariffId,
        type: SubscriptionType.PAID,
        startAt: now,
        endAt: new Date(now.getTime() + durationMs),
        status: SubscriptionStatus.ACTIVE,
        allowedDevices: tariff.allowedDevices,
      },
    });

    return {
      scenario,
      subscription,
      tariffDurationDays: tariff.durationDays,
      allowedDevices: tariff.allowedDevices,
    };
  }

  if (scenario === PurchaseScenario.RENEW) {
    const newEnd = new Date(activeSubscription.endAt.getTime() + durationMs);

    const subscription = await prisma.subscription.update({
      where: { id: activeSubscription.id },
      data: {
        endAt: newEnd,
        type: SubscriptionType.EXTENDED,
      },
    });

    // Важно: при RENEW мы не генерируем новые конфиги, оставляем старые. :contentReference[oaicite:7]{index=7}
    return {
      scenario,
      subscription,
      tariffDurationDays: tariff.durationDays,
      allowedDevices: tariff.allowedDevices,
    };
  }

  // Для UPGRADE/DOWNGRADE/CROSS_PURCHASE в Phase 1:
  // упрощённо закрываем старую и создаём новую, чтобы не усложнять логику.
  if (activeSubscription) {
    await prisma.subscription.update({
      where: { id: activeSubscription.id },
      data: {
        status: SubscriptionStatus.CANCELLED,
        statusReason: `Replaced by new purchase (${scenario})`,
      },
    });
  }

  const subscription = await prisma.subscription.create({
    data: {
      userId,
      tariffId,
      type: SubscriptionType.PAID,
      startAt: now,
      endAt: new Date(now.getTime() + durationMs),
      status: SubscriptionStatus.ACTIVE,
      allowedDevices: tariff.allowedDevices,
    },
  });

  return {
    scenario,
    subscription,
    tariffDurationDays: tariff.durationDays,
    allowedDevices: tariff.allowedDevices,
  };
}

