import { Composer } from "grammy";
import { getOrCreateUser } from "../database.js";
import { mainMenuKb } from "../keyboards/inline.js";
import { WEBAPP_URL } from "../config.js";

export const startRouter = new Composer();

startRouter.command("start", async (ctx) => {
  const user = ctx.from!;
  const dbUser = await getOrCreateUser(user.id, user.username, user.first_name ?? "");

  const free = dbUser.free_generations;
  let freeText = "";
  if (free > 0) {
    const word = free === 1 ? "бесплатная генерация" : free <= 4 ? "бесплатных генерации" : "бесплатных генераций";
    freeText = `У вас есть <b>${free} ${word}</b>!\n`;
  }

  await ctx.reply(
    `Привет, ${user.first_name}! 👋\n\n` +
    "Я помогу изменить ваше фото: оставлю ваше лицо, но изменю позу, одежду или фон " +
    "по вашему описанию.\n\n" +
    `${freeText}` +
    `💰 Баланс: <b>${dbUser.balance.toFixed(0)}₽</b>\n\n` +
    "Нажмите <b>«Сгенерировать»</b>, чтобы начать.\n\n" +
    `📄 <a href="${WEBAPP_URL}/oferta">Публичная оферта</a>`,
    { reply_markup: mainMenuKb(user.id), parse_mode: "HTML" },
  );
});
