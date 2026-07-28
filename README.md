# ImageTransformationTGBot-TS

## Пробный запуск (локально через Yarn)

```bash
cd /opt/bots/ImageTransformationTGBot-TS

# 1. Создать .env.local с необходимыми переменными
cp .env.local.example .env.local

# 2. Установить зависимости
yarn install

# 3. Собрать TypeScript → JS
yarn build

# 4. Запустить
yarn start
```

> **Важно:** для пробного запуска нужна PostgreSQL, прописанная в `.env.local`.

Альтернатива — режим разработки без компиляции:
```bash
yarn dev
```

---

## Запуск веб-интерфейса для разработки

Установите зависимости и запустите фронтенд:

```bash
cd /home/alivkon/projects/RitualHUB/ImageTransformationTGBot-TS
yarn install
yarn dev:frontend
```

Откройте адрес, который выведет Vite в терминале — обычно это
`http://localhost:5173`.

Фронтенд перенаправляет запросы `/api` и `/uploads` на бэкенд по адресу
`http://localhost:8080`. Для работы API поднимите локальную PostgreSQL и
запустите бэкенд во втором терминале:

```bash
docker compose -f docker-compose.local.yml up -d postgres
yarn dev
```

Перед запуском создайте и заполните `.env.local` на основе
`.env.local.example`: укажите параметры подключения к БД и необходимые
переменные бота, включая `BOT_TOKEN`.

---

## Продакшн-деплой (Docker Compose на сервере)

```bash
cd /opt/bots/ImageTransformationTGBot-TS

# 1. Создать/проверить .env
nano .env
# Нужные переменные: BOT_TOKEN, POSTGRES_PASSWORD и другие по конфигу

# 2. Собрать и поднять контейнеры
docker compose up -d --build

# 3. Проверить статус
docker compose ps
docker compose logs -f bot
```
 # Изменения на сервере
```bash
 # Сборка и перезапуск только программного кода без пересборки БД
yarn build && sudo docker compose build bot && docker compose up -d bot
```

После запуска:
- Бот работает в контейнере `imagetransformationtgbot_ts`
- PostgreSQL — в контейнере `postgre_imagetransformer`
- Traefik автоматически выдаёт TLS и роутит трафик на `imagetransformation.ru`
