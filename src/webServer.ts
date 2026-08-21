import crypto from "node:crypto";
import path from "node:path";
import Fastify from "fastify";
import staticPlugin from "@fastify/static";
import formbody from "@fastify/formbody";
import multipart from "@fastify/multipart";
import type { Bot } from "grammy";
import { registerAuthRoutes } from "./web/auth.js";
import { registerUploadRoute } from "./web/uploadRoute.js";
import { registerGenerateRoute } from "./web/generateRoute.js";
import { registerWebPaymentRoutes } from "./web/paymentRoute.js";
import IPCIDR from "ip-cidr";
import {
  ADMIN_ID,
  BOT_TOKEN,
  TOPUP_OPTIONS,
  WEB_SERVER_PORT,
  YOOKASSA_SKIP_IP_CHECK,
} from "./config.js";
import {
  confirmationToken,
  createPayment,
  findPayment,
  isYookassaConfigured,
} from "./services/yookassa.js";
import {
  createPendingYookassaPayment,
  creditManualBalance,
  creditYookassaPayment,
  getAdminGenerations,
  getAdminPayments,
  getAdminStats,
  getAdminUsers,
  getUser,
  setFreeGenerations,
} from "./database.js";

const STATIC_DIR = path.resolve(__dirname, "../static");

// YooKassa IP whitelist
const YOOKASSA_CIDR_RANGES = [
  new IPCIDR("185.71.76.0/27"),
  new IPCIDR("185.71.77.0/27"),
  new IPCIDR("77.75.153.0/25"),
  new IPCIDR("77.75.154.128/25"),
  new IPCIDR("2a02:5180::/32"),
];
const YOOKASSA_SINGLE_IPS = new Set(["77.75.156.11", "77.75.156.35"]);

function isYookassaIp(ipStr: string): boolean {
  if (ipStr.startsWith("::ffff:")) ipStr = ipStr.slice(7);
  if (YOOKASSA_SINGLE_IPS.has(ipStr)) return true;
  return YOOKASSA_CIDR_RANGES.some((cidr) => cidr.contains(ipStr));
}

function validateInitData(initData: string): Record<string, string> | null {
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  if (!receivedHash) return null;
  params.delete("hash");

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const expected = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (expected.length !== receivedHash.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(receivedHash))) return null;

  return Object.fromEntries(params.entries());
}

function requireAdmin(authHeader: string | undefined): boolean {
  if (!authHeader?.startsWith("tma ")) return false;
  const parsed = validateInitData(authHeader.slice(4));
  if (!parsed) return false;
  try {
    const user = JSON.parse(parsed["user"] ?? "{}") as { id?: number };
    return Number(user.id) === ADMIN_ID;
  } catch {
    return false;
  }
}

function rowsToJson(rows: Record<string, unknown>[]): unknown[] {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([k, v]) => [
        k,
        v instanceof Date ? v.toISOString() : v,
      ]),
    ),
  );
}

const UPLOADS_DIR = path.resolve(__dirname, "../uploads");
const FRONTEND_DIST_DIR = path.resolve(__dirname, "../frontend-dist");

export async function startWebServer(bot: Bot): Promise<void> {
  const fastify = Fastify({ logger: true });

  await fastify.register(formbody);
  await fastify.register(multipart);

  // Telegram WebApp static files (admin panel, payment pages)
  await fastify.register(staticPlugin, { root: STATIC_DIR, prefix: "/", wildcard: false });

  // User uploads (photos + generated results)
  await fastify.register(staticPlugin, {
    root: UPLOADS_DIR,
    prefix: "/uploads/",
    decorateReply: false,
  });

  // Register web API routes
  registerAuthRoutes(fastify);
  registerUploadRoute(fastify);
  registerGenerateRoute(fastify, bot);
  registerWebPaymentRoutes(fastify);

  // Frontend SPA (served only if frontend-dist exists)
  const fs = await import("node:fs");
  if (fs.existsSync(FRONTEND_DIST_DIR)) {
    await fastify.register(staticPlugin, {
      root: FRONTEND_DIST_DIR,
      prefix: "/app/",
      decorateReply: false,
    });

    fastify.get("/app", (_req, reply) => reply.code(308).redirect("/app/"));
    fastify.get("/app/", (_req, reply) => reply.sendFile("index.html", FRONTEND_DIST_DIR));

    fastify.setNotFoundHandler((req, reply) => {
      const pathname = req.url.split("?")[0] ?? req.url;
      const looksLikeStaticAsset = path.extname(pathname) !== "";
      if (!pathname.startsWith("/app/") || looksLikeStaticAsset) {
        return reply.code(404).type("text/plain").send("Not Found");
      }
      return reply.sendFile("index.html", FRONTEND_DIST_DIR);
    });
  }

  // Public, crawlable website. It intentionally consists of ready HTML rather
  // than the authenticated JavaScript application served at /app/.
  const publicPages: Record<string, string> = {
    "/": "site/index.html",
    "/delovoy-portret-iz-foto": "site/delovoy-portret-iz-foto.html",
    "/uluchshit-gruppovoe-foto": "site/uluchshit-gruppovoe-foto.html",
    "/restavraciya-staryh-foto": "site/restavraciya-staryh-foto.html",
    "/raskrasit-cherno-beloe-foto": "site/raskrasit-cherno-beloe-foto.html",
    "/zhivopisnyy-portret-kak-podarok-na-yubiley": "site/zhivopisnyy-portret-kak-podarok-na-yubiley.html",
    "/kak-polzovatsya": "site/kak-polzovatsya.html",
    "/o-servise": "site/o-servise.html",
  };
  for (const [url, file] of Object.entries(publicPages)) {
    fastify.get(url, (_req, reply) => reply.sendFile(file));
  }

  // Static pages
  fastify.get("/oferta", (_req, reply) => {
    reply.header("ngrok-skip-browser-warning", "true");
    return reply.sendFile("oferta.html");
  });

  fastify.get("/privacy", (_req, reply) => {
    reply.header("ngrok-skip-browser-warning", "true");
    return reply.sendFile("privacy.html");
  });

  fastify.get("/pay_yookassa", (_req, reply) => {
    reply.header("ngrok-skip-browser-warning", "true");
    return reply.sendFile("pay_yookassa.html");
  });

  fastify.get("/pay_robokassa", (_req, reply) => {
    return reply.code(404).send();
  });

  fastify.get("/admin", (_req, reply) => {
    return reply.sendFile("admin.html");
  });

  // Admin API
  fastify.get("/api/admin/stats", async (req, reply) => {
    if (!requireAdmin(req.headers["authorization"])) return reply.code(403).send();
    const stats = await getAdminStats();
    return reply.send(stats);
  });

  fastify.get<{ Querystring: { page?: string } }>("/api/admin/generations", async (req, reply) => {
    if (!requireAdmin(req.headers["authorization"])) return reply.code(403).send();
    const page = Math.max(0, parseInt(req.query.page ?? "0", 10));
    const rows = await getAdminGenerations(50, page * 50);
    return reply.send(rowsToJson(rows));
  });

  fastify.get<{ Querystring: { page?: string } }>("/api/admin/users", async (req, reply) => {
    if (!requireAdmin(req.headers["authorization"])) return reply.code(403).send();
    const page = Math.max(0, parseInt(req.query.page ?? "0", 10));
    const rows = await getAdminUsers(200, page * 200);
    return reply.send(rowsToJson(rows));
  });

  fastify.get<{ Querystring: { page?: string } }>("/api/admin/payments", async (req, reply) => {
    if (!requireAdmin(req.headers["authorization"])) return reply.code(403).send();
    const page = Math.max(0, parseInt(req.query.page ?? "0", 10));
    const rows = await getAdminPayments(50, page * 50);
    return reply.send(rowsToJson(rows));
  });

  fastify.post("/api/admin/set-free", async (req, reply) => {
    if (!requireAdmin(req.headers["authorization"])) return reply.code(403).send();
    const body = req.body as { user_id?: unknown; count?: unknown };
    const userId = parseInt(String(body.user_id ?? ""), 10);
    const count = parseInt(String(body.count ?? "3"), 10);
    if (isNaN(userId) || isNaN(count)) return reply.code(400).send({ error: "Invalid params" });
    await setFreeGenerations(userId, count);
    return reply.send({ ok: true });
  });

  fastify.post("/api/admin/credit-balance", async (req, reply) => {
    if (!requireAdmin(req.headers["authorization"])) return reply.code(403).send();
    const body = req.body as { user_id?: unknown; amount?: unknown; note?: unknown };
    const userId = parseInt(String(body.user_id ?? ""), 10);
    const amount = parseFloat(String(body.amount ?? ""));
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 200) : "";

    if (!Number.isFinite(userId) || !Number.isFinite(amount) || amount <= 0) {
      return reply.code(400).send({ error: "Invalid user_id or amount" });
    }

    const result = await creditManualBalance({
      userId,
      amount,
      ...(note ? { note } : {}),
    });
    if (!result) return reply.code(404).send({ error: "User not found" });

    await bot.api
      .sendMessage(
        userId,
        `✅ Баланс пополнен администратором.\n\n` +
        `Зачислено: <b>${amount.toFixed(0)}₽</b>\n` +
        `Ваш баланс: <b>${result.balance.toFixed(0)}₽</b>`,
        { parse_mode: "HTML" },
      )
      .catch(() => undefined);

    return reply.send({ ok: true, balance: result.balance, payment_id: result.paymentId });
  });

  // YooKassa — create embedded payment
  fastify.post("/api/payment/create", async (req, reply) => {
    const body = req.body as { user_id?: unknown; amount?: unknown };
    const userId = parseInt(String(body.user_id ?? ""), 10);
    const amount = parseInt(String(body.amount ?? ""), 10);

    if (isNaN(userId) || isNaN(amount)) {
      return reply.code(400).send({ error: "user_id and amount are required" });
    }
    if (!(TOPUP_OPTIONS as readonly number[]).includes(amount)) {
      return reply.code(400).send({ error: `Invalid amount. Allowed: ${TOPUP_OPTIONS.join(", ")}` });
    }

    const user = await getUser(userId);
    if (!user) return reply.code(404).send({ error: "User not found" });

    if (!isYookassaConfigured()) {
      fastify.log.error("YooKassa не настроена: YOOKASSA_SHOP_ID/YOOKASSA_SECRET_KEY содержат значения-заглушки");
      return reply.code(503).send({
        error: "Оплата не настроена: в окружении не заданы реальные YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY",
      });
    }

    try {
      const payment = await createPayment(userId, amount);
      const token = confirmationToken(payment);

      if (!token || typeof payment.id !== "string") {
        fastify.log.error("YooKassa не вернула confirmation_token: %j", payment);
        return reply.code(502).send({
          error: "YooKassa не вернула токен формы оплаты. Проверьте, что для магазина включён встроенный виджет (confirmation type embedded).",
        });
      }

      // Фиксируем платёж до оплаты, чтобы сверка добрала его, если ни вебхук,
      // ни подтверждение из браузера не сработают.
      await createPendingYookassaPayment({ userId, amount, yookassaPaymentId: payment.id });

      return reply.send({ confirmation_token: token, payment_id: payment.id });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      fastify.log.error("YooKassa create payment error: %s", msg);
      return reply.code(502).send({ error: `Не удалось создать платёж: ${msg}` });
    }
  });

  fastify.post("/api/payment/yookassa/confirm", async (req, reply) => {
    const body = req.body as { user_id?: unknown; payment_id?: unknown };
    const userId = parseInt(String(body.user_id ?? ""), 10);
    const paymentId = typeof body.payment_id === "string" ? body.payment_id : "";

    if (!Number.isFinite(userId) || !paymentId) {
      return reply.code(400).send({ error: "user_id and payment_id are required" });
    }

    let payment: Awaited<ReturnType<typeof findPayment>>;
    try {
      payment = await findPayment(paymentId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      fastify.log.error("YooKassa confirm lookup error: %s", msg);
      return reply.code(502).send({ error: `Не удалось проверить платёж: ${msg}` });
    }

    if (payment.status !== "succeeded") {
      const user = await getUser(userId);
      return reply.send({ credited: false, status: payment.status, balance: user?.balance ?? 0 });
    }

    const metadataUserId = parseInt(payment.metadata?.user_id ?? "0", 10);
    if (metadataUserId !== userId) {
      fastify.log.warn("YooKassa confirm metadata mismatch: payment=%s user=%s metadata=%s", paymentId, userId, metadataUserId);
      return reply.code(403).send({ error: "Payment belongs to another user" });
    }

    const amount = parseFloat(payment.amount?.value ?? "0");
    if (!Number.isFinite(amount) || amount <= 0) {
      return reply.code(400).send({ error: "Invalid payment amount" });
    }

    const result = await creditYookassaPayment({ userId, amount, yookassaPaymentId: paymentId });
    return reply.send({ credited: result.credited, status: payment.status, balance: result.balance });
  });

  // YooKassa webhook
  fastify.post("/yookassa/webhook", async (req, reply) => {
    const forwarded = req.headers["x-forwarded-for"];
    const clientIp = (typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() : req.ip) ?? req.ip;
    fastify.log.info("YooKassa webhook received from IP=%s, x-forwarded-for=%s", clientIp, forwarded);
    if (!YOOKASSA_SKIP_IP_CHECK && !isYookassaIp(clientIp)) {
      fastify.log.warn("Webhook from unknown IP: %s", clientIp);
      return reply.code(403).send();
    }
    if (YOOKASSA_SKIP_IP_CHECK) {
      fastify.log.warn("YOOKASSA_SKIP_IP_CHECK enabled — skipping IP whitelist check");
    }

    const data = req.body as Record<string, unknown>;
    fastify.log.info("YooKassa webhook body: %o", data);
    if (data["type"] !== "notification" || data["event"] !== "payment.succeeded") {
      fastify.log.info(
        "YooKassa webhook ignored: type=%s event=%s",
        data["type"],
        data["event"],
      );
      return reply.code(200).send();
    }

    const paymentId = (data["object"] as Record<string, unknown> | undefined)?.["id"];
    if (typeof paymentId !== "string") return reply.code(400).send();

    let payment: Awaited<ReturnType<typeof findPayment>>;
    try {
      payment = await findPayment(paymentId);
    } catch (err) {
      fastify.log.error("YooKassa find_one error: %s", err instanceof Error ? err.message : err);
      return reply.code(500).send();
    }

    if (payment.status !== "succeeded") return reply.code(200).send();

    const userId = parseInt(payment.metadata?.user_id ?? "0", 10);
    const amount = parseFloat(payment.amount?.value ?? "0");

    if (!userId) {
      fastify.log.error(
        "YooKassa webhook has no user_id in metadata: %o",
        payment.metadata ?? {},
      );
      fastify.log.error("No user_id in payment metadata: %s", paymentId);
      return reply.code(200).send();
    }

    const result = await creditYookassaPayment({ userId, amount, yookassaPaymentId: paymentId });
    if (!result.credited) return reply.code(200).send();

    await bot.api
      .sendMessage(
        userId,
        `✅ Оплата прошла успешно!\n\n` +
        `Зачислено: <b>${amount.toFixed(0)}₽</b>\n` +
        `Ваш баланс: <b>${result.balance.toFixed(0)}₽</b>`,
        { parse_mode: "HTML" },
      )
      .catch(() => undefined);

    return reply.code(200).send();
  });

  await fastify.listen({ port: WEB_SERVER_PORT, host: "0.0.0.0" });
}
