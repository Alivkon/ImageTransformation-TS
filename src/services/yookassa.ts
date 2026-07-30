import crypto from "node:crypto";
import { YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY } from "../config.js";

const API_BASE = "https://api.yookassa.ru/v3/payments";
const TIMEOUT_MS = 15_000;

export type YookassaPayment = {
  id?: string;
  status?: string;
  amount?: { value?: string };
  confirmation?: { confirmation_token?: string };
  confirmation_token?: string;
  metadata?: { user_id?: string };
};

function authHeader(): string {
  return `Basic ${Buffer.from(`${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET_KEY}`).toString("base64")}`;
}

// В окружении могут остаться значения-заглушки из .env.local.example — с ними YooKassa
// отвечает "Login has illegal format", и без этой проверки причина сбоя не видна.
export function isYookassaConfigured(): boolean {
  const looksUnset = (v: string): boolean => !v || /placeholder|^your[-_]/i.test(v);
  return !looksUnset(YOOKASSA_SHOP_ID) && !looksUnset(YOOKASSA_SECRET_KEY);
}

// Объект ошибки YooKassa тоже содержит поле id, поэтому без этой проверки ошибка
// неотличима от успешно созданного платежа.
function ensureOk(resp: Response, data: Record<string, unknown>): void {
  if (resp.ok && data["type"] !== "error") return;
  const code = typeof data["code"] === "string" ? data["code"] : String(resp.status);
  const description =
    typeof data["description"] === "string" ? data["description"] : "неизвестная ошибка";
  throw new Error(`${description} (${code})`);
}

export async function createPayment(userId: number, amount: number): Promise<YookassaPayment> {
  const resp = await fetch(API_BASE, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
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
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const data = (await resp.json()) as Record<string, unknown>;
  ensureOk(resp, data);
  return data as YookassaPayment;
}

export async function findPayment(paymentId: string): Promise<YookassaPayment> {
  const resp = await fetch(`${API_BASE}/${paymentId}`, {
    headers: { Authorization: authHeader() },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const data = (await resp.json()) as Record<string, unknown>;
  ensureOk(resp, data);
  return data as YookassaPayment;
}

// Токен встроенного виджета. Лежит в confirmation.confirmation_token; верхний уровень
// оставлен как фолбэк для совместимости с прежним поведением.
export function confirmationToken(payment: YookassaPayment): string | null {
  const token = payment.confirmation?.confirmation_token ?? payment.confirmation_token;
  return typeof token === "string" && token ? token : null;
}
