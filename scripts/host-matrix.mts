// Локальная проверка host-маршрутизации (Этап 6 плана миграции).
// Запуск: yarn tsx scripts/host-matrix.mts  — сервер на :8099, без внешних вызовов.
process.env.BOT_TOKEN ??= "dummy";
process.env.KIE_API_KEY ??= "dummy";
process.env.YOOKASSA_TOKEN ??= "dummy";
process.env.YOOKASSA_SHOP_ID ??= "dummy-shop";
process.env.YOOKASSA_SECRET_KEY ??= "dummy-secret";
process.env.ADMIN_ID ??= "1";
process.env.DATABASE_URL ??= "postgresql://dummy:dummy@127.0.0.1:5432/dummy";
process.env.SMTP_HOST ??= "localhost";
process.env.WEB_SERVER_PORT ??= "8099";

const { startWebServer } = await import("../src/webServer.js");
const stubBot = {
  api: { sendMessage: async () => ({ message_id: 1 }), },
} as unknown as import("grammy").Bot;

await startWebServer(stubBot);
console.log("HOST-MATRIX SERVER UP ON", process.env.WEB_SERVER_PORT);
