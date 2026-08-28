import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import staticPlugin from "@fastify/static";
import formbody from "@fastify/formbody";
import multipart from "@fastify/multipart";
import type { Bot } from "grammy";
import type { FastifyReply, FastifyRequest } from "fastify";
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
  MAIN_HOST,
  MAIN_ORIGIN,
  classifyHost,
  selfOriginOf,
  type HostClassification,
} from "./domains.js";
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
const CONTENT_DIR = path.resolve(__dirname, "../content");

/** Все пути файлов внутри static/ — единственные URL, отдаваемые тематическим доменам. */
function collectAssetPaths(root: string): ReadonlySet<string> {
  const paths = new Set<string>();
  const walk = (dir: string, prefix: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
      else paths.add(rel);
    }
  };
  walk(root, "");
  return paths;
}
const ASSET_PATHS: ReadonlySet<string> = collectAssetPaths(STATIC_DIR);

/**
 * Кому доверять x-forwarded-* заголовкам (Решение о trustProxy).
 * По умолчанию — loopback и приватные docker-сети (порт 8080 наружу не публикуется).
 * Значение "none" отключает доверие полностью.
 */
const TRUST_PROXY = process.env.TRUST_PROXY ?? "loopback,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16";

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
  const trustProxy =
    TRUST_PROXY === "none"
      ? false
      : TRUST_PROXY.split(",")
          .map((part) => part.trim())
          .filter(Boolean);
  const fastify = Fastify({ logger: true, trustProxy });

  await fastify.register(formbody);
  await fastify.register(multipart);

  // ── Рендеринг страниц из content/ с подстановкой плейсхолдеров (Решение 8) ──
  interface TemplateContext {
    selfOrigin: string;
    mainOrigin: string;
    host: string;
  }
  const renderedCache = new Map<string, string>();

  const readContent = (relPath: string): string | null => {
    try {
      return fs.readFileSync(path.join(CONTENT_DIR, relPath), "utf8");
    } catch {
      return null;
    }
  };

  const rendered = (relPath: string, ctx: TemplateContext): string | null => {
    const cacheKey = `${ctx.selfOrigin}::${relPath}`;
    const cached = renderedCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const raw = readContent(relPath);
    if (raw === null) return null;
    const html = raw.replace(/\{\{(\w+)\}\}/g, (placeholder: string, key: string) => {
      switch (key) {
        case "SELF_URL":
        case "SELF_ORIGIN":
          return ctx.selfOrigin;
        case "MAIN_ORIGIN":
        case "APP_ORIGIN":
          return ctx.mainOrigin;
        case "HOST":
          return ctx.host;
        default:
          fastify.log.warn("Неизвестный плейсхолдер шаблона: %s", placeholder);
          return "";
      }
    });
    renderedCache.set(cacheKey, html);
    return html;
  };

  const pageContext = (cls: HostClassification): TemplateContext => ({
    selfOrigin: selfOriginOf(cls),
    mainOrigin: MAIN_ORIGIN,
    host: cls.kind === "local" ? MAIN_HOST : cls.host ?? "",
  });

  // ── Host-gate: что видно с каждого домена (Решения 3, 5, 6) ──────────────
  // unknown → 404; landing → только /, robots, sitemap и ассеты static/;
  // main/local → всё. Хук зарегистрирован до всех маршрутов и статики.
  fastify.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    const cls = classifyHost(req.headers.host);
    const pathname = (req.url.split("?")[0] ?? "/") || "/";
    if (cls.kind === "unknown") {
      await reply.code(404).type("text/plain").send("Not Found");
      return;
    }
    if (cls.kind !== "landing") return;
    if (pathname === "/" || pathname === "/robots.txt" || pathname === "/sitemap.xml") return;
    if (ASSET_PATHS.has(pathname)) return;
    await reply.code(404).type("text/plain").send("Not Found");
  });

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
  if (fs.existsSync(FRONTEND_DIST_DIR)) {
    await fastify.register(staticPlugin, {
      root: FRONTEND_DIST_DIR,
      prefix: "/app/",
      decorateReply: false,
    });

    fastify.get("/app", (_req, reply) => reply.code(308).redirect("/app/"));
    fastify.get("/app/", (_req, reply) => reply.sendFile("index.html", FRONTEND_DIST_DIR));

    fastify.setNotFoundHandler((req, reply) => {
      // Двойная защита: хук уже отсекает чужие домены, здесь — на случай,
      // если запрос дошёл до not-found мимо маршрутов.
      const cls = classifyHost(req.headers.host);
      if (cls.kind === "unknown" || cls.kind === "landing") {
        return reply.code(404).type("text/plain").send("Not Found");
      }
      const pathname = req.url.split("?")[0] ?? req.url;
      const looksLikeStaticAsset = path.extname(pathname) !== "";
      if (!pathname.startsWith("/app/") || looksLikeStaticAsset) {
        return reply.code(404).type("text/plain").send("Not Found");
      }
      return reply.sendFile("index.html", FRONTEND_DIST_DIR);
    });
  }

  // Публичные страницы по доменам. Старые пути лендингов
  // (/uluchshit-gruppovoe-foto и т.п.) сознательно НЕ регистрируются —
  // они отдают 404 на основном домене (Решение 3).
  fastify.get("/", (req, reply) => {
    const cls = classifyHost(req.headers.host);
    if (cls.kind === "unknown") {
      return reply.code(404).type("text/plain").send("Not Found");
    }
    const rel = cls.kind === "landing" ? cls.route.landingFile : "site/index.html";
    const html = rendered(rel, pageContext(cls));
    if (html === null) {
      return reply.code(404).type("text/plain").send("Not Found");
    }
    return reply.type("text/html; charset=utf-8").send(html);
  });

  // Информационные и служебные страницы — только основной домен
  // (доступ с тематических доменов отсечён host-gate хуком).
  const singlePages: Record<string, string> = {
    "/oferta": "oferta.html",
    "/privacy": "privacy.html",
    "/o-servise": "site/o-servise.html",
    "/kak-polzovatsya": "site/kak-polzovatsya.html",
    "/pay_yookassa": "pay_yookassa.html",
    "/admin": "admin.html",
  };
  for (const [url, file] of Object.entries(singlePages)) {
    fastify.get(url, (_req, reply) => {
      const html = readContent(file);
      if (html === null) return reply.code(404).type("text/plain").send("Not Found");
      return reply.type("text/html; charset=utf-8").send(html);
    });
  }

  fastify.get("/pay_robokassa", (_req, reply) => {
    return reply.code(404).send();
  });

  // robots.txt и sitemap.xml зависят от домена запроса (раздел 5 базового плана).
  // Лендинги индексируются (§5 плана миграции: self-canonical + sitemap с URL "/"):
  // разрешаем сканирование и отдаём свой sitemap. Прежний "Disallow: /" блокировал
  // сканирование лендингов в GSC/Яндекс Вебмастере. Сервисные пути (/app/, /api/,
  // /uploads/, /admin, /pay_yookassa) на лендингах и так отвечают 404 через host-gate.
  const landingRobots = (host: string): string =>
    ["User-agent: *", "Allow: /", "", `Sitemap: https://${host}/sitemap.xml`, ""].join("\n");
  fastify.get("/robots.txt", (req, reply) => {
    const cls = classifyHost(req.headers.host);
    if (cls.kind === "landing") {
      return reply.type("text/plain; charset=utf-8").send(landingRobots(cls.host));
    }
    const body = [
      "User-agent: *",
      "# Приложение закрыто; примеры картинок нужны лендингам основного домена.",
      "Disallow: /app/",
      "Allow: /app/images/",
      "Disallow: /api/",
      "Disallow: /uploads/",
      "Disallow: /admin",
      "Disallow: /pay_yookassa",
      "",
      `Sitemap: ${MAIN_ORIGIN}/sitemap.xml`,
      "",
    ].join("\n");
    return reply.type("text/plain; charset=utf-8").send(body);
  });

  fastify.get("/sitemap.xml", (req, reply) => {
    const cls = classifyHost(req.headers.host);
    const entry = (loc: string, priority: string, changefreq: string): string =>
      `  <url>\n    <loc>${loc}</loc>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
    const urls =
      cls.kind === "landing"
        ? entry(`https://${cls.host}/`, "1.0", "weekly")
        : [
            entry(`${MAIN_ORIGIN}/`, "1.0", "weekly"),
            entry(`${MAIN_ORIGIN}/kak-polzovatsya`, "0.6", "monthly"),
            entry(`${MAIN_ORIGIN}/o-servise`, "0.6", "monthly"),
            entry(`${MAIN_ORIGIN}/oferta`, "0.3", "monthly"),
            entry(`${MAIN_ORIGIN}/privacy`, "0.3", "monthly"),
          ].join("\n");
    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
    return reply.type("application/xml; charset=utf-8").send(xml);
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
