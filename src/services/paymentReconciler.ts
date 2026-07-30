import type { Bot } from "grammy";
import {
  creditYookassaPayment,
  listPendingYookassaPayments,
  markYookassaPaymentStatus,
} from "../database.js";
import { findPayment, isYookassaConfigured } from "./yookassa.js";

// Основные пути зачисления — вебхук YooKassa и подтверждение из браузера после
// success виджета. Оба могут не сработать: вебхук режется по IP или прокси,
// браузер — если пользователь закрыл вкладку сразу после оплаты. Сверка добирает
// такие платежи по записям со статусом pending.
const INTERVAL_MS = 5 * 60_000;
// Виджет подтверждает оплату за секунды, так что свежие pending трогать незачем.
const MIN_AGE_SECONDS = 120;
// Дальше платёж заведомо не оплатят (у YooKassa он истекает), перестаём опрашивать.
const GIVE_UP_AFTER_MS = 24 * 60 * 60_000;
const BATCH_LIMIT = 50;

async function reconcileOnce(bot: Bot): Promise<void> {
  const pending = await listPendingYookassaPayments({
    olderThanSeconds: MIN_AGE_SECONDS,
    limit: BATCH_LIMIT,
  });
  if (!pending.length) return;

  for (const row of pending) {
    if (Date.now() - row.createdAt.getTime() > GIVE_UP_AFTER_MS) {
      await markYookassaPaymentStatus(row.yookassaPaymentId, "abandoned");
      continue;
    }

    let payment: Awaited<ReturnType<typeof findPayment>>;
    try {
      payment = await findPayment(row.yookassaPaymentId);
    } catch (err) {
      // Сетевая ошибка или недоступность API — попробуем на следующем проходе.
      console.error(
        `Сверка платежей: не удалось проверить ${row.yookassaPaymentId}: %s`,
        err instanceof Error ? err.message : err,
      );
      continue;
    }

    if (payment.status === "canceled") {
      await markYookassaPaymentStatus(row.yookassaPaymentId, "canceled");
      continue;
    }
    if (payment.status !== "succeeded") continue;

    // Сумму берём из ответа YooKassa: она авторитетнее локальной записи.
    const amount = parseFloat(payment.amount?.value ?? "") || row.amount;
    const result = await creditYookassaPayment({
      userId: row.userId,
      amount,
      yookassaPaymentId: row.yookassaPaymentId,
    });
    if (!result.credited) continue;

    console.log(
      `Сверка платежей: зачислено ${amount}₽ пользователю ${row.userId} по платежу ${row.yookassaPaymentId}`,
    );

    // Для веб-пользователей user_id не телеграмный, поэтому отправка может не пройти.
    await bot.api
      .sendMessage(
        row.userId,
        `✅ Оплата прошла успешно!\n\n` +
        `Зачислено: <b>${amount.toFixed(0)}₽</b>\n` +
        `Ваш баланс: <b>${result.balance.toFixed(0)}₽</b>`,
        { parse_mode: "HTML" },
      )
      .catch(() => undefined);
  }
}

export function startPaymentReconciler(bot: Bot): NodeJS.Timeout | null {
  if (!isYookassaConfigured()) {
    console.warn("Сверка платежей не запущена: YooKassa не настроена");
    return null;
  }

  const tick = (): void => {
    void reconcileOnce(bot).catch((err) => {
      console.error("Сверка платежей упала:", err);
    });
  };

  const timer = setInterval(tick, INTERVAL_MS);
  timer.unref();
  tick();
  return timer;
}
