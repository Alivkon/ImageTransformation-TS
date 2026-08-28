# ImageTransformationTGBot-TS

## Пробный запуск (локально через Yarn)

```bash
cd /opt/bots/ImageTransformationTGBot-TS

# 1. Создать .env.local с необходимыми переменными
cp .env.local.example .env.local

# 2. Установить зависимости
yarn install

# 3. Собрать бэкенд и фронтенд: tsc → dist/, vite → frontend-dist/
yarn build:all

# 4. Запустить
yarn start
```

> **Важно:** для пробного запуска нужна PostgreSQL, прописанная в `.env.local`.

> **Важно:** нужен именно `yarn build:all`, а не `yarn build`. `yarn build` — это только
> `tsc`; без каталога `frontend-dist/` сервер вообще не регистрирует приложение на `/app/`
> (см. `src/webServer.ts`), и по этому адресу будет 404.

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

Приложение собирается с `base: "/app/"`, поэтому в dev-сервере Vite оно открывается по
адресу `http://localhost:5173/app/`, а не по корню. Публичный сайт из `static/site/`
Vite не раздаёт вообще — его отдаёт бэкенд, смотрите его на `http://localhost:8080/`.

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

## Карта URL

Что по какому адресу отдаёт бэкенд (`src/webServer.ts`):

| URL | Источник | Что это |
| --- | --- | --- |
| `/`, `/o-servise`, `/kak-polzovatsya` и другие посадочные | `static/site/` | Публичный статический сайт, готовый HTML для индексации |
| `/app/` | `frontend-dist/` | Приложение на Vite (SPA), собирается с `base: "/app/"` |
| `/uploads/` | `uploads/` | Загруженные фото и результаты генераций |
| `/admin`, `/oferta`, `/privacy`, `/pay_yookassa` | `static/` | Отдельные страницы Telegram WebApp и юридические документы |
| `/robots.txt`, `/sitemap.xml`, `/favicon.ico` | `static/` | Служебные файлы (раньше лежали в `frontend/public/`) |

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
sudo docker compose build bot && docker compose up -d bot
```

Собирать проект на хосте перед этим не нужно: `Dockerfile` сам выполняет `yarn build:all`
внутри образа, а хостовые `dist/` и `node_modules/` в образ не попадают — они в
`.dockerignore`.

После запуска:
- Бот работает в контейнере `imagetransformationtgbot_ts`
- PostgreSQL — в контейнере `postgre_imagetransformer_ts` (сервис `postgres` из этого compose)
- Traefik автоматически выдаёт TLS и роутит трафик на `imagetransformation.ru`

portret-iz-foto-ai.ru
raskrasitfoto-ai.ru
restavraciyafoto-ai.ru
semeynoe-foto-ai.ru
gruppovoe-foto.ru
delovoy-portret-ai.ru