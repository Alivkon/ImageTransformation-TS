import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Bot } from "grammy";
import {
  getUser,
  addBalance,
  savePayment,
  createRobokassaInvoice,
  confirmRobokassaInvoice,
} from "../database.js";
import {
  TOPUP_OPTIONS,
  YOOKASSA_SHOP_ID,
  YOOKASSA_SECRET_KEY,
  ROBOKASSA_MERCHANT_LOGIN,
  ROBOKASSA_PASSWORD1,
  ROBOKASSA_PASSWORD2,
  ROBOKASSA_TEST_MODE,
} from "../config.js";
import { requireAuth } from "./auth.js";

// YooKassa HTTP helpers (reused from webServer.ts logic)
function yookassaAuthHeader(): string {
  return `Basic ${Buffer.from(`${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET_KEY}`).toString("base64")}`;
}

async function yookassaCreatePayment(
  userId: number,
  amount: number,
): Promise<Record<string, unknown>> {
  const resp = await fetch("https://api.yookassa.ru/v3/payments", {
    method: "POST",
    headers: {
      Authorization: yookassaAuthHeader(),
      "Content-Type": "application/json",
      "Idempotence-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      amount: { value: amount.toFixed(2), currency: "RUB" },
      confirmation: { type: "embedded" },
      capture: true,
      description: `Пополнение баланса на ${amount}₽`,
      metadata: { user_id: String(userId) },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  return (await resp.json()) as Record<string, unknown>;
}

// Robokassa MD5 signature
import { createHash } from "node:crypto";

function robokassaSig(parts: (string | number)[]): string {
  return createHash("md5").update(parts.join(":")).digest("hex").toLowerCase();
}

function robokassaPaymentUrl(outSum: string, invId: number): string {
  const sig = robokassaSig([ROBOKASSA_MERCHANT_LOGIN, outSum, invId, ROBOKASSA_PASSWORD1]);
  const params = new URLSearchParams({
    MerchantLogin: ROBOKASSA_MERCHANT_LOGIN,
    OutSum: outSum,
    InvId: String(invId),
    SignatureValue: sig,
    IsTest: ROBOKASSA_TEST_MODE ? "1" : "0",
  });
  return `https://auth.robokassa.ru/Merchant/Index.aspx?${params.toString()}`;
}

export function registerWebPaymentRoutes(fastify: FastifyInstance, bot: Bot): void {

  // YooKassa — create embedded payment widget token
  fastify.post("/api/web/payment/yookassa", async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;

    const body = req.body as { amount?: unknown };
    const amount = parseInt(String(body.amount ?? ""), 10);

    if (!(TOPUP_OPTIONS as readonly number[]).includes(amount)) {
      return reply.code(400).send({ error: `Invalid amount. Allowed: ${TOPUP_OPTIONS.join(", ")}` });
    }

    try {
      const payment = await yookassaCreatePayment(user.user_id, amount);
      const confirmation = payment["confirmation"] as Record<string, unknown> | undefined;
      const token = confirmation?.["confirmation_token"];
      return reply.send({ confirmation_token: token });
    } catch (err) {
      fastify.log.error("YooKassa web payment error: %s", err);
      return reply.code(500).send({ error: "Payment creation failed" });
    }
  });

  // Robokassa — create invoice and return redirect URL
  fastify.post("/api/web/payment/robokassa", async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;

    const body = req.body as { amount?: unknown };
    const amount = parseInt(String(body.amount ?? ""), 10);

    if (!(TOPUP_OPTIONS as readonly number[]).includes(amount)) {
      return reply.code(400).send({ error: `Invalid amount. Allowed: ${TOPUP_OPTIONS.join(", ")}` });
    }

    const invId = await createRobokassaInvoice(user.user_id, amount);
    const outSum = `${amount}.00`;
    const paymentUrl = robokassaPaymentUrl(outSum, invId);
    return reply.send({ payment_url: paymentUrl });
  });

  // Robokassa result callback — handles both bot and web payments
  // (Already registered in webServer.ts for the bot. Here we expose a
  //  separate endpoint for the web frontend to confirm after redirect.)
  fastify.get<{ Querystring: { InvId?: string } }>(
    "/api/web/payment/robokassa/confirm",
    async (req, reply) => {
      const user = await requireAuth(req, reply);
      if (!user) return;

      // After Robokassa redirect, the client confirms by polling this
      const invId = parseInt(req.query.InvId ?? "", 10);
      if (isNaN(invId)) return reply.code(400).send({ error: "Missing InvId" });

      const dbUser = await getUser(user.user_id);
      return reply.send({ balance: dbUser?.balance ?? 0 });
    },
  );

  // Suppress unused imports
  void bot;
  void addBalance;
  void savePayment;
  void confirmRobokassaInvoice;
}
