# Перевод прода на базу из docker-compose

Инструкция для выполнения **на сервере** (`srv668198`, каталог `/opt/bots/ImageTransformationTGBot-TS`).
Всё, что можно было проверить на машине разработчика, уже проверено — см. «Что проверено локально».

## Зачем

Бот подключался к контейнеру `postgre_imagetransformer`, который **не описан в этом репозитории**:
он принадлежит compose-проекту `imagetransformationtgbot` (старая Python-версия, `/opt/bots/ImageTransformationTGBot`).
Одновременно этот compose поднимал свой контейнер `postgre_imagetransformer_ts`, в который никто не ходил —
там лежала июньская копия базы, замороженная на 15.06.2026.

Пара проблем из-за этого:

- инфраструктура прода не описана в репозитории целиком;
- комментарий в `docker-compose.yml` предлагал «использовать имя сервиса», и следование ему молча
  переключило бы бота на копию — схема совпадает, ошибок бы не было, а свежие данные пропали бы из виду;
- healthcheck `pg_isready -U postgres` рапортовал «healthy» для базы, в которой роли `postgres` не существует.

После миграции бот работает с контейнером `postgre_imagetransformer_ts` (сервис `postgres` этого compose),
а легаси-контейнер не нужен.

**Данные переносить не нужно** — согласовано с владельцем: важна только структура таблиц, её создаёт
`initDb()` при старте бота. Балансы, платежи и пользователи (8 записей) будут потеряны, пользователи
заведутся заново с `FREE_GENERATIONS=3`.

## Что изменено в репозитории

Коммит с правкой `docker-compose.yml`:

| Параметр | Было | Стало |
|---|---|---|
| `DATABASE_URL` бота | `postgresql://imagetransformer:***@postgre_imagetransformer/imagetransformer` | `postgresql://postgres:${POSTGRES_PASSWORD}@postgres:5432/imagetransformer` |
| `POSTGRES_DB` | `postgres` | `imagetransformer` |
| healthcheck | `pg_isready -U postgres` | `pg_isready -U postgres -d imagetransformer` |
| публикация порта | `5434:5432` | закомментирована (доступ только по внутренней сети) |

Пользователь БД теперь `postgres` (как в `docker-compose.local.yml`), пароль — из `POSTGRES_PASSWORD` в `.env`.

## Предусловия

```bash
cd /opt/bots/ImageTransformationTGBot-TS
git pull
git log --oneline -1          # должен быть коммит про docker-compose / перевод БД
grep -n "DATABASE_URL" docker-compose.yml
```

Ожидается строка `DATABASE_URL: postgresql://postgres:${POSTGRES_PASSWORD}@postgres:5432/imagetransformer`.
**Если её нет — дальше не идти**, изменения не подтянулись.

Проверить, что в `.env` есть переменные (значения не выводить в чат):

```bash
grep -c -E "^(POSTGRES_PASSWORD|BOT_TOKEN|ADMIN_ID|KIE_API_KEY|YOOKASSA_SHOP_ID|YOOKASSA_SECRET_KEY|YOOKASSA_TOKEN)=" .env
```

Ожидается `7`. Меньше — бот не стартует: эти переменные помечены `required()` в `src/config.ts`.
`DATABASE_URL` в `.env` может быть любым, его перекрывает `environment:` в compose.

## Миграция

Бот будет недоступен ~1–2 минуты, traefik в это время отдаёт 502.

```bash
# 1. Останавливаем bot и его postgres
docker compose down

# 2. Удаляем том с июньской копией.
#    Обязательный шаг: POSTGRES_USER/POSTGRES_DB применяются только при первой
#    инициализации каталога данных. Без удаления база imagetransformer не появится.
docker volume rm imagetransformationtgbot-ts_postgres_data

# 3. Собираем и поднимаем
sudo docker compose build bot && docker compose up -d

# 4. Смотрим лог старта
docker compose logs --tail=50 bot
```

В логе должно быть `Starting bot...` и `Server listening`, без ошибок `initDb` и без `ECONNREFUSED`.

## Проверка результата

```bash
docker exec -i postgre_imagetransformer_ts psql -U postgres -d imagetransformer \
  -c "\dt" \
  -c "select column_name, column_default from information_schema.columns
      where table_name='payments' and column_name='status';" \
  -c "select indexname from pg_indexes where tablename='payments' order by indexname;"
```

Ожидаемый результат (проверено локально на пустой базе):

- **6 таблиц**: `email_verifications`, `generations`, `payments`, `uploads`, `users`, `web_sessions`.
  Трёх таблиц `email_clicks`, `email_opens`, `email_recipients` из старого проекта быть не должно —
  этот код их не создаёт;
- колонка `payments.status` с дефолтом `'succeeded'::text`;
- индексы `idx_payments_pending`, `idx_payments_yookassa_id`, `payments_pkey`.

Затем функциональная проверка:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://imagetransformation.ru/     # ожидается 200
```

Открыть сайт, зарегистрироваться заново, нажать «Оплатить» — должна отрисоваться форма YooKassa.
Если вместо формы появляется модалка с текстом ошибки — это уже не про базу, смотреть раздел
«Оплата» ниже.

Когда всё работает, остановить легаси-контейнер (том **не удалять**, это точка отката):

```bash
docker stop postgre_imagetransformer
```

## Откат

```bash
cd /opt/bots/ImageTransformationTGBot-TS
docker start postgre_imagetransformer
git revert <хеш коммита с docker-compose>     # либо вручную вернуть DATABASE_URL на postgre_imagetransformer
docker compose up -d
```

Данные легаси-базы остаются в томе `imagetransformationtgbot_postgres_data`, пока его не удалили.

## Троблшутинг

**`FATAL: role "postgres" does not exist`** — том не пересоздан (шаг 2 пропущен либо compose был старый
на момент подъёма). Повторить `docker compose down` → `docker volume rm imagetransformationtgbot-ts_postgres_data`
→ `docker compose up -d`.

**`FATAL: database "imagetransformer" does not exist`** — том инициализирован со старым `POSTGRES_DB: postgres`.
Лечится так же, как предыдущий пункт, но сначала убедиться, что в `docker-compose.yml` уже стоит
`POSTGRES_DB: imagetransformer`.

**Бот в цикле перезапусков** (`docker ps` показывает `Restarting`) — смотреть `docker compose logs --tail=80 bot`.
Чаще всего: не хватает переменной из `required()` в `src/config.ts` либо база недоступна.

**Traefik отдаёт 502** — бот не слушает 8080. Проверить, что `WEB_SERVER_PORT` в `.env` **не задан**
или равен `8080`: traefik ходит на `loadbalancer.server.port=8080`, локальное значение 8090 сюда не годится.

**Оплата: модалка с ошибкой вместо формы.** Тексты теперь конкретные:
- `Оплата не настроена…` → в `.env` не заданы `YOOKASSA_SHOP_ID` / `YOOKASSA_SECRET_KEY`;
- `Не удалось создать платёж: … (invalid_credentials)` → ключи неверные;
- `YooKassa не вернула токен формы оплаты…` → у магазина не включён встроенный виджет (confirmation type `embedded`).

## Что проверено локально (повторять на сервере не нужно)

- `docker compose config` для нового `docker-compose.yml` — синтаксис валиден, подстановки раскрываются;
- контейнер `postgres:16-alpine` с `POSTGRES_USER=postgres`, `POSTGRES_DB=imagetransformer`: роль и база
  создаются, healthcheck `pg_isready -U postgres -d imagetransformer` проходит;
- `initDb()` на **пустой** базе создаёт все 6 таблиц, `payments.status` с дефолтом `succeeded`
  и индекс `idx_payments_pending`;
- полный цикл платежа на свежей базе: `pending` → зачисление (`credited: true`) → повторный вызов
  (`credited: false`, баланс не задваивается);
- сверка платежей: просроченная запись помечается `abandoned`, несуществующий `payment_id` логируется
  и остаётся `pending` для следующей попытки.

Не проверено и проверяемо только на сервере: сеть traefik, реальная оплата картой и приход вебхука
YooKassa на `https://imagetransformation.ru/yookassa/webhook`.
