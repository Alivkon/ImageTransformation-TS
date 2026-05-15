import { Composer, InputFile } from "grammy";
import {
  getUser,
  getOrCreateUser,
  deductBalance,
  deductFreeGeneration,
  incrementTotalGenerations,
  createGeneration,
  completeGeneration,
  failGeneration,
  addBalance,
} from "../database.js";
import { generateImage, KieError } from "../services/kieai.js";
import { mainMenuKb, paywallKb } from "../keyboards/inline.js";
import { BOT_TOKEN, GENERATION_COST, ADMIN_ID, DISCOUNTED_COST, DISCOUNTED_USER_IDS } from "../config.js";

export const generateRouter = new Composer();

const HOW_TO_TEXT =
  "❓ <b>Как правильно писать запрос</b>\n\n" +
  "Важно понять главное: ИИ берёт из вашего фото <b>только лицо</b>.\n" +
  "Поза, одежда, фон — всё остальное рисуется заново по вашему описанию.\n\n" +
  "<b>Что описать в подписи к фото:</b>\n" +
  "• Одежда — «деловой костюм», «спортивная форма», «вечернее платье»\n" +
  "• Поза — «стоит прямо», «уверенная поза», «руки в карманах»\n" +
  "• Фон — «белый студийный фон», «офис», «природа», «горы»\n\n" +
  "<b>✅ Примеры хороших запросов:</b>\n" +
  "— «Деловой костюм, белый офисный фон, уверенная поза»\n" +
  "— «Спортивная форма, стадион на фоне, динамичная поза»\n" +
  "— «Военная форма, нейтральный серый фон, строгая осанка»\n" +
  "— «Свадебное платье, цветочный сад, мягкий свет»\n\n" +
  "<b>❌ Что не работает:</b>\n" +
  "— «Сделай лучше» — непонятно что именно менять\n" +
  "— «Улучши фото» — ИИ не дорабатывает, а рисует заново\n" +
  "— «Красиво» — слишком расплывчато\n\n" +
  "<i>💡 Описывайте как фотографу: что надето, в какой позе стоит человек, что на фоне.</i>";

generateRouter.callbackQuery("how_to", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply(HOW_TO_TEXT, { parse_mode: "HTML", reply_markup: mainMenuKb() });
});

generateRouter.callbackQuery("generate", async (ctx) => {
  await ctx.answerCallbackQuery();
  await getOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name ?? "");
  await ctx.reply(
    "📸 Отправьте фото с подписью — опишите позу, одежду и фон.\n\n" +
    "<b>Помните:</b> ИИ берёт только ваше лицо, остальное рисует по описанию.\n\n" +
    "<b>Пример:</b> «Деловой костюм, белый офисный фон, уверенная поза»\n\n" +
    "<i>Не знаете как описать? Нажмите «❓ Как писать запрос» в меню.</i>",
    { parse_mode: "HTML" },
  );
});

// Photo with caption — main generation handler
generateRouter.on("message:photo").filter(
  (ctx) => ctx.message.caption !== undefined,
  async (ctx) => {
    const user = ctx.from;
    const dbUser = await getOrCreateUser(user.id, user.username, user.first_name ?? "");

    const photos = ctx.message.photo;
    const photoFileId = photos[photos.length - 1]!.file_id;
    const prompt = ctx.message.caption!;

    const isAdmin = user.id === ADMIN_ID;
    const isDiscounted = DISCOUNTED_USER_IDS.has(user.id);
    const effectiveCost = isDiscounted ? DISCOUNTED_COST : GENERATION_COST;

    let isFree = 0;
    let cost = effectiveCost;

    if (isAdmin) {
      isFree = 1;
      cost = 0;
    } else if (dbUser.free_generations > 0) {
      isFree = 1;
      cost = 0;
    } else if (dbUser.balance < effectiveCost) {
      await ctx.reply(
        `⚠️ Недостаточно средств.\n\n` +
        `Стоимость генерации: <b>${effectiveCost}₽</b>\n` +
        `Ваш баланс: <b>${dbUser.balance.toFixed(0)}₽</b>\n\n` +
        "Пополните баланс, чтобы продолжить.",
        { reply_markup: paywallKb(), parse_mode: "HTML" },
      );
      return;
    }

    const processingMsg = await ctx.reply("⏳ Генерирую изображение, подождите...");

    const generationId = await createGeneration(user.id, prompt, photoFileId, cost, isFree);

    if (isFree && !isAdmin) {
      await deductFreeGeneration(user.id);
    } else if (!isFree) {
      await deductBalance(user.id, cost);
    }
    await incrementTotalGenerations(user.id);

    let resultBytes: Buffer;
    try {
      const file = await ctx.api.getFile(photoFileId);
      const imageUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;

      resultBytes = await generateImage(imageUrl, prompt);
    } catch (err) {
      await failGeneration(generationId);
      if (!isFree) await addBalance(user.id, cost);
      await ctx.api.deleteMessage(ctx.chat!.id, processingMsg.message_id).catch(() => undefined);

      const errMsg = err instanceof KieError ? String(err.message) : String(err);
      await ctx.reply(
        `❌ Ошибка при генерации: ${errMsg}\n\nСредства возвращены на баланс.`,
        { reply_markup: mainMenuKb() },
      );
      return;
    }

    try {
      const inputFile = new InputFile(resultBytes, "result.jpg");
      const sent = await ctx.replyWithPhoto(inputFile, {
        caption: "✅ Готово! Отправьте новое фото с подписью, чтобы сделать ещё одну.",
        reply_markup: mainMenuKb(),
      });
      const resultFileId = sent.photo[sent.photo.length - 1]!.file_id;
      await completeGeneration(generationId, resultFileId);

      if (!isAdmin) {
        const usernameStr = user.username ? `@${user.username}` : `id:${user.id}`;
        await ctx.api
          .sendPhoto(ADMIN_ID, resultFileId, {
            caption: `🎨 Результат\n👤 ${user.first_name ?? ""} ${usernameStr}\n📝 ${prompt}`,
          })
          .catch(() => undefined);
      }
    } catch (err) {
      await failGeneration(generationId);
      await ctx.reply(
        `❌ Изображение сгенерировано, но не удалось отправить: ${String(err)}`,
        { reply_markup: mainMenuKb() },
      );
      return;
    }

    await ctx.api.deleteMessage(ctx.chat!.id, processingMsg.message_id).catch(() => undefined);
  },
);

// Photo without caption
generateRouter.on("message:photo").filter(
  (ctx) => ctx.message.caption === undefined,
  async (ctx) => {
    await ctx.reply(
      "📝 Фото получено, но нет подписи.\n\n" +
      "Отправьте фото ещё раз <b>с подписью</b> — опишите в ней одежду, позу и фон.\n\n" +
      "<b>Пример:</b> «Деловой костюм, белый офисный фон, уверенная поза»\n\n" +
      "<i>ИИ берёт только ваше лицо — всё остальное рисует по описанию.</i>",
      { parse_mode: "HTML", reply_markup: mainMenuKb() },
    );
  },
);

generateRouter.callbackQuery("balance", async (ctx) => {
  await ctx.answerCallbackQuery();
  const dbUser = await getUser(ctx.from.id);
  if (!dbUser) {
    await ctx.reply("Нажмите /start для начала.");
    return;
  }
  await ctx.reply(
    `💰 Ваш баланс: <b>${dbUser.balance.toFixed(0)}₽</b>\n` +
    `🎨 Всего генераций: <b>${dbUser.total_generations}</b>\n` +
    `🎁 Бесплатных генераций: <b>${dbUser.free_generations}</b>`,
    { reply_markup: mainMenuKb(), parse_mode: "HTML" },
  );
});

generateRouter.callbackQuery("back_to_menu", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply("Главное меню:", { reply_markup: mainMenuKb() });
});
