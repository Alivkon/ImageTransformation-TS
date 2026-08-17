# Запуск проекта через Docker Compose

Текущий `docker-compose.yml` предназначен для запуска на сервере за Traefik. Он поднимает два сервиса:

- `bot` — Telegram-бот и веб-приложение;
- `postgres` — PostgreSQL 16.

> Используйте команду `docker compose` без дефиса. Имя сервиса приложения — `bot`, а не `app`.

## Требования

- Docker Engine;
- Docker Compose v2 (`docker compose`);
- внешняя Docker-сеть `n8n_default`, к которой подключён Traefik;
- заполненный файл `.env`.

Проверьте установку:

```bash
docker --version
docker compose version
```

Если команда `docker-compose` не найдена, устанавливать устаревший Compose v1 не нужно: используйте `docker compose`.

## Первый запуск

Перейдите в каталог проекта:

```bash
cd /opt/bots/ImageTransformationTGBot-TS
```

Создайте файл окружения и замените значения-заглушки:

```bash
cp .env.example .env
nano .env
```

Для запуска обязательны как минимум:

- `BOT_TOKEN`;
- `ADMIN_ID`;
- `KIE_API_KEY`;
- `YOOKASSA_TOKEN`;
- `YOOKASSA_SHOP_ID`;
- `YOOKASSA_SECRET_KEY`;
- `POSTGRES_PASSWORD`.

`DATABASE_URL` внутри контейнера `bot` задаётся Compose автоматически и указывает на сервис `postgres`. Значение `WEB_SERVER_PORT` оставьте равным `8080`, поскольку этот же порт настроен в Dockerfile и Traefik.

Проверьте наличие внешней сети:

```bash
docker network inspect n8n_default
```

Обычно эту сеть создаёт Compose-проект с Traefik/n8n. Если её ещё нет, создайте вручную:

```bash
docker network create n8n_default
```

Соберите образы и запустите оба сервиса в фоне:

```bash
docker compose up -d --build
```

Сервис `bot` дождётся успешной проверки PostgreSQL, после чего запустится сам.

## Проверка запуска

```bash
docker compose ps
docker compose logs --tail 100 bot
docker compose logs --tail 100 postgres
```

Следить за логами приложения в реальном времени:

```bash
docker compose logs -f bot
```

Веб-приложение не публикует порт `8080` на хост. Оно доступно через Traefik по адресу `https://imagetransformation.ru`. Директива `expose` открывает порт только для других контейнеров в Docker-сетях.

## Обновление приложения

Пересобрать и перезапустить только программный сервис, не пересоздавая PostgreSQL:

```bash
docker compose build bot
docker compose up -d bot
```

Или одной командой:

```bash
docker compose up -d --build bot
```

При запуске `bot` Compose также проверит его зависимость от `postgres`.

Для полной пересборки без кеша:

```bash
docker compose build --no-cache bot
docker compose up -d bot
```

Собирать TypeScript и frontend на хосте не требуется: Dockerfile выполняет `yarn build:all` внутри build-образа.

## Остановка и перезапуск

```bash
# Перезапустить приложение
docker compose restart bot

# Остановить и удалить контейнеры и внутреннюю сеть проекта
docker compose down

# Снова запустить существующие образы
docker compose up -d
```

Данные PostgreSQL находятся в именованном томе `postgres_data`, а загруженные файлы — в каталоге `./uploads` на хосте. Обычная команда `docker compose down` их не удаляет.

> `docker compose down -v` удаляет том PostgreSQL вместе со всей базой. Используйте её только если данные больше не нужны или есть проверенная резервная копия.

## Работа с PostgreSQL

Открыть консоль базы:

```bash
docker compose exec postgres psql -U postgres -d imagetransformer
```

Создать дамп в текущем каталоге хоста:

```bash
docker compose exec -T postgres pg_dump -U postgres -d imagetransformer > backup.sql
```

Восстановить базу из дампа:

```bash
docker compose exec -T postgres psql -U postgres -d imagetransformer < backup.sql
```

Порт PostgreSQL на хост не опубликован. Бот подключается к базе по адресу `postgres:5432` во внутренней сети `imgtransform_net`.

## Диагностика

Проверить итоговую конфигурацию и имена сервисов:

```bash
docker compose config --services
docker compose config --quiet
```

Посмотреть все последние логи:

```bash
docker compose logs --tail 200
```

Открыть shell в контейнере:

```bash
docker compose exec bot sh
docker compose exec postgres sh
```

Проверить готовность PostgreSQL:

```bash
docker compose exec postgres pg_isready -U postgres -d imagetransformer
```

Посмотреть состояние Docker healthcheck приложения:

```bash
docker inspect --format='{{json .State.Health}}' imagetransformationtgbot_ts
```

### `no such service: app`

В Compose нет сервиса `app`. Используйте:

```bash
docker compose up -d --build bot
```

### `network n8n_default declared as external, but could not be found`

Запустите Compose-проект с Traefik/n8n, который создаёт эту сеть, либо создайте её вручную:

```bash
docker network create n8n_default
```

### Контейнер `bot` завершается сразу после запуска

Проверьте логи и наличие обязательных значений в `.env`:

```bash
docker compose logs --tail 200 bot
```

### Ошибка подключения к PostgreSQL

Убедитесь, что `POSTGRES_PASSWORD` задан в `.env`, а PostgreSQL прошёл healthcheck:

```bash
docker compose ps
docker compose logs --tail 200 postgres
```

Переменные `POSTGRES_USER`, `POSTGRES_PASSWORD` и `POSTGRES_DB` применяются образом PostgreSQL только при первой инициализации пустого тома. Их изменение в `.env` не меняет пароль в уже созданной базе автоматически.

### `permission denied` при обращении к Docker

Запускайте команды через `sudo` либо добавьте пользователя в группу `docker` согласно документации вашей ОС. После изменения групп обычно требуется заново войти в систему.
