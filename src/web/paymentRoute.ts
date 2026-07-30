import type { FastifyInstance } from "fastify";
import {
  getUser,
  createPendingYookassaPayment,
  creditYookassaPayment,
} from "../database.js";
import { MIN_TOPUP } from "../config.js";
import {
  confirmationToken,
  createPayment,
  findPayment,
  isYookassaConfigured,
} from "../services/yookassa.js";
import { requireAuth } from "./auth.js";

export function registerWebPaymentRoutes(fastify: FastifyInstance): void {

  // YooKassa — create embedded payment widget token
  fastify.post("/api/web/payment/yookassa", async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;

    const body = req.body as { amount?: unknown };
    const amount = Number(body.amount);

    if (!Number.isSafeInteger(amount) || amount < MIN_TOPUP) {
      return reply.code(400).send({ error: `Минимальная сумма пополнения — ${MIN_TOPUP}₽` });
    }

    if (!isYookassaConfigured()) {
      fastify.log.error("YooKassa не настроена: YOOKASSA_SHOP_ID/YOOKASSA_SECRET_KEY содержат значения-заглушки");
      return reply.code(503).send({
        error: "Оплата не настроена: в окружении не заданы реальные YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY",
      });
    }

    try {
      const payment = await createPayment(user.user_id, amount);
      const token = confirmationToken(payment);
      const paymentId = payment.id;

      if (!token || typeof paymentId !== "string") {
        fastify.log.error("YooKassa не вернула confirmation_token: %j", payment);
        return reply.code(502).send({
          error: "YooKassa не вернула токен формы оплаты. Проверьте, что для магазина включён встроенный виджет (confirmation type embedded).",
        });
      }

      // Фиксируем платёж до оплаты, чтобы сверка добрала его, если ни вебхук,
      // ни подтверждение из браузера не сработают.
      await createPendingYookassaPayment({ userId: user.user_id, amount, yookassaPaymentId: paymentId });

      return reply.send({ confirmation_token: token, payment_id: paymentId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      fastify.log.error("YooKassa web payment error: %s", msg);
      return reply.code(502).send({ error: `Не удалось создать платёж: ${msg}` });
    }
  });

  // YooKassa — fallback confirmation for the web widget.
  // The webhook remains the primary path, but this reconciles successful
  // payments when the webhook is delayed or rejected by proxy/IP settings.
  fastify.post("/api/web/payment/yookassa/confirm", async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;

    const body = req.body as { payment_id?: unknown };
    const paymentId = typeof body.payment_id === "string" ? body.payment_id : "";
    if (!paymentId) return reply.code(400).send({ error: "payment_id is required" });

    let payment: Awaited<ReturnType<typeof findPayment>>;
    try {
      payment = await findPayment(paymentId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      fastify.log.error("YooKassa web confirm lookup error: %s", msg);
      return reply.code(502).send({ error: `Не удалось проверить платёж: ${msg}` });
    }

    if (payment.status !== "succeeded") {
      const dbUser = await getUser(user.user_id);
      return reply.send({ credited: false, status: payment.status, balance: dbUser?.balance ?? 0 });
    }

    const metadataUserId = parseInt(payment.metadata?.user_id ?? "0", 10);
    if (metadataUserId !== user.user_id) {
      fastify.log.warn("YooKassa web confirm metadata mismatch: payment=%s user=%s metadata=%s", paymentId, user.user_id, metadataUserId);
      return reply.code(403).send({ error: "Payment belongs to another user" });
    }

    const amount = parseFloat(payment.amount?.value ?? "0");
    if (!Number.isFinite(amount) || amount <= 0) {
      return reply.code(400).send({ error: "Invalid payment amount" });
    }

    const result = await creditYookassaPayment({ userId: user.user_id, amount, yookassaPaymentId: paymentId });
    return reply.send({ credited: result.credited, status: payment.status, balance: result.balance });
  });

}
