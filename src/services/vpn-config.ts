import { InputFile } from "grammy";
import type { VpnConfigItem } from "./vpn-api";
import type { BotContext } from "../bot";
import { prisma } from "../db/prisma";
import { deflateSync } from "zlib";

type SendableConfig = {
  protocol: string;
  configText: string;
  qrData?: string | null;
};

// Оставляем на будущее, но сейчас НЕ используем в кнопках
function generateAmneziaLink(configText: string, description: string): string {
  const configJson = {
    containers: [
      {
        container_type: "amnezia-awg",
        service_name: "AmneziaWG",
        awg: {
          last_config: JSON.stringify({ config: configText }),
          port: 443,
          transport_proto: "udp",
          mtu: 1280,
          host_name: "VPN Server",
        },
      },
    ],
    description: description,
    created_at: new Date().toISOString(),
  };

  const jsonBuf = Buffer.from(JSON.stringify(configJson), "utf8");
  const compressed = deflateSync(jsonBuf);

  const sizeBuf = Buffer.alloc(4);
  sizeBuf.writeUInt32BE(jsonBuf.length, 0);

  const finalBuf = Buffer.concat([sizeBuf, compressed]);

  const base64 = finalBuf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return `vpn://${base64}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizeProtocol(p: string): string {
  const v = p.toLowerCase();
  if (v === "awg") return "amneziawg";
  return v;
}

function prettyName(protocol: string): { title: string; emoji: string; order: number } {
  const p = normalizeProtocol(protocol);
  if (p === "vless_reality") return { title: "VLESS Reality", emoji: "🛡", order: 1 };
  if (p === "amneziawg") return { title: "AWG (AmneziaWG)", emoji: "🚀", order: 2 };
  return { title: protocol, emoji: "📱", order: 99 };
}

async function maybeSendQr(
  ctx: BotContext,
  protocol: string,
  qrData?: string | null,
): Promise<void> {
  if (!qrData) return;

  const m = qrData.match(/data:image\/(png|jpeg);base64,(.*)/i);
  if (!m) return;

  const ext = m[1].toLowerCase() === "jpeg" ? "jpg" : "png";
  const buf = Buffer.from(m[2], "base64");
  const { title } = prettyName(protocol);

  await ctx.replyWithPhoto(new InputFile(buf, `qr.${ext}`), {
    caption: `🔗 QR ${title}`,
  });
}

async function sendIntro(ctx: BotContext): Promise<void> {
  const intro = `✅ <b>Ваши VPN-конфиги готовы!</b>

📱 <b>Как подключиться (30 секунд):</b>

<b>1. Скачай AmneziaVPN</b>
• 📲 <a href="https://play.google.com/store/apps/details?id=org.amnezia.vpn&hl=ru">Google Play</a>
• 🍎 <a href="https://apps.apple.com/us/app/amneziavpn/id1600529900?l=ru">App Store</a>
2. Открой → <b>+</b> → вставь <b>AWG</b> конфиг → <b>Подключиться</b> ✅

⚠️ <b>Конфиги только для вас!</b>`;

  await ctx.reply(intro, { parse_mode: "HTML" as const });
}

async function sendOneConfig(ctx: BotContext, cfg: SendableConfig): Promise<void> {
  const proto = normalizeProtocol(cfg.protocol);

  // Временно полностью скрываем VLESS в этом интерфейсе
  if (proto === "vless_reality") {
    return;
  }

  const { title, emoji } = prettyName(cfg.protocol);
  const header = `${emoji} <b>${title}</b>\n`;

  let body = "";

  if (proto === "amneziawg") {
    const safeConfig = escapeHtml(cfg.configText);
    const codeBlock =
      `<pre style="word-wrap: break-word; white-space: pre-wrap; font-size: 0.9em; line-height: 1.2;">` +
      safeConfig +
      `</pre>`;

    let vpnLinkInfo = "";
    try {
      const vpnLink = generateAmneziaLink(cfg.configText, `VPN ${title}`);
      vpnLinkInfo =
        `\n<b>Импорт в AmneziaVPN:</b>\n` +
        `1) Скопируй строку ниже целиком (начинается с <code>vpn://</code>)\n` +
        `2) Открой её через AmneziaVPN\n` +
        `<pre style="word-wrap: break-word; white-space: pre-wrap; font-size: 0.78em; line-height: 1.2;">${escapeHtml(vpnLink)}</pre>`;
    } catch (e) {
      console.error("❌ AmneziaLink generation failed:", e);
    }

    body = codeBlock + vpnLinkInfo;
  } else {
    const safeConfig = escapeHtml(cfg.configText);
    body =
      `<pre style="word-wrap: break-word; white-space: pre-wrap; font-size: 0.9em; line-height: 1.2;">` +
      safeConfig +
      `</pre>`;
  }

  const msg = header + body;

  try {
    if (msg.length <= 4000) {
      await ctx.reply(msg, { parse_mode: "HTML" as const });
    } else {
      const isAwg = proto === "amneziawg";
      const filename = isAwg ? "amnezia.vpn" : "config.txt";

      const caption =
        `${emoji} ${title}\n` +
        `<b>Как использовать:</b>\n` +
        `Открой этот файл через приложение <b>AmneziaVPN</b>, чтобы импортировать конфигурацию.`;

      await ctx.replyWithDocument(
        new InputFile(Buffer.from(cfg.configText, "utf8"), filename),
        {
          caption,
          parse_mode: "HTML" as const,
        },
      );
    }
  } catch (error) {
    console.error(`❌ Error sending ${title}:`, error);
    await ctx.reply(`❌ Ошибка при отправке ${title}`);
  }

  try {
    await maybeSendQr(ctx, cfg.protocol, cfg.qrData);
  } catch (e) {
    console.error("⚠️ QR sending failed:", e);
  }
}


function pickTwoRequired(configs: SendableConfig[]): SendableConfig[] {
  const byProto = new Map<string, SendableConfig>();
  for (const c of configs) {
    const p = normalizeProtocol(c.protocol);
    if (!byProto.has(p)) byProto.set(p, c);
  }

  const ordered = ["vless_reality", "amneziawg"]
    .map((p) => byProto.get(p))
    .filter(Boolean) as SendableConfig[];

  const orderedProtocols = ordered.map((c: SendableConfig) =>
    normalizeProtocol(c.protocol),
  );
  const rest = configs
    .filter((c: SendableConfig) => !orderedProtocols.includes(normalizeProtocol(c.protocol)))
    .sort(
      (a: SendableConfig, b: SendableConfig) =>
        prettyName(a.protocol).order - prettyName(b.protocol).order,
    );

  return [...ordered, ...rest];
}

export async function sendConfigsToUser(
  ctx: BotContext,
  configs: VpnConfigItem[],
): Promise<void> {
  if (!configs?.length) {
    await ctx.reply("❌ Конфиги не доступны.");
    return;
  }

  const sendable: SendableConfig[] = configs.map((c) => ({
    protocol: c.protocol,
    configText: c.config_text,
    qrData: c.qr_data ?? null,
  }));

  const ordered = pickTwoRequired(sendable);

  await sendIntro(ctx);
  for (const cfg of ordered) {
    await sendOneConfig(ctx, cfg);
  }
}

export async function sendExistingConfigsForActiveSubscription(
  ctx: BotContext,
  userId: number,
): Promise<void> {
  const sub = await prisma.subscription.findFirst({
    where: {
      userId,
      status: "ACTIVE",
      endAt: { gt: new Date() },
    },
    orderBy: { endAt: "desc" },
  });

  if (!sub) {
    await ctx.reply("❌ У вас нет активной подписки.");
    return;
  }

  const configs = await prisma.vpnConfig.findMany({
    where: {
      userId,
      subscriptionId: sub.id,
      revokedAt: null,
    },
    orderBy: { protocolType: "asc" },
  });

  if (!configs.length) {
    await ctx.reply("❌ Конфиги не найдены.");
    return;
  }

  const sendable: SendableConfig[] = configs.map((c) => ({
    protocol: c.protocolType,
    configText: c.configText.toString("utf8"),
    qrData: c.qrData ?? null,
  }));

  const ordered = pickTwoRequired(sendable);

  await sendIntro(ctx);
  for (const cfg of ordered) {
    await sendOneConfig(ctx, cfg);
  }
}
