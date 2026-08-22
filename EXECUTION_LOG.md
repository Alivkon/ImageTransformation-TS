# Журнал выполнения миграции на новые домены

План: `DOMAIN_MIGRATION_EXECUTION_PLAN.md` · Ревизия: `PLAN_REVIEW_REPORT.html`
Старт работ: 22.08.2026

> Формат записи: `[дата время] Этап → что сделано → результат`. Записи добавляются по мере выполнения.

## Статус этапов

| Этап | Описание | Статус |
|---|---|---|
| 0 | Подготовка: инвентаризация Traefik, DNS, почта | ✅ инвентаризация + домены/DNS (5/6, raskrasitfoto — у владельца); ящик почты — владелец |
| 1 | Конфигурация доменов в коде (`src/domains.ts`, WEBAPP_URL, trustProxy) | ✅ выполнено |
| 2 | Перестройка каталогов (`content/`, чистка `static/`) | ✅ выполнено |
| 3 | Маршрутизация Fastify (host-gate, 404, dev-fallback, robots/sitemap) | ✅ выполнено |
| 4 | Шаблоны страниц (плейсхолдеры, удаление счётчиков, CTA) | ✅ выполнено |
| 5 | Почта и контакты (BCC, SMTP_FROM, юридику) | ✅ код готов; ящик/MX — владелец |
| 6 | Локальная проверка (build + curl-матрица) | ✅ 21/21 PASS |
| 7 | Вечер D0: деплой + внешние системы + удаление старого домена | 🔄 роутеры/TLS/деплой/smoke ✅; ждёт DNS raskrasitfoto, BotFather, ЮKassa, ящик → затем удаление старого |
| 8 | Дни D1+: наблюдение и чистка репозитория | ⬜ |

---

## Записи о выполненных шагах

### [22.08.2026] Этап 0 — Инвентаризация Traefik (Решение 1) → ✅ ВЫПОЛНЕНО

**Шаг 0.1. Поиск Traefik-инстансов** (`docker ps`, `docker network ls`, `docker network inspect n8n_default`):
- На хосте один Traefik: контейнер **`n8n-traefik-1`** (traefik:v3.3, Up 3 days), сеть `n8n_default`.
- Сеть `traefik_traefik` существует, но активных контейнеров в ней не обнаружено.
- В `n8n_default`: `n8n-traefik-1`, `upscaler`, `wellness_workshop_agent`, `ritual_retouch`. Бот в сети отсутствует (см. находку ниже).

**Шаг 0.2. Инспекция `n8n-traefik-1`**:
- Монтирования: `/opt/traefik-dynamic → /etc/traefik/dynamic`; том `n8n_traefik_data → /letsencrypt`; **`/var/run/docker.sock` смонтирован**, но…
- Аргументы (полный список): только `--providers.file.directory=/etc/traefik/dynamic` + watch; **флагов `--providers.docker*` НЕТ** → docker-провайдер выключен (в v3 отключён по умолчанию) ⇒ **labels из docker-compose.yml бота не читаются никем = мёртвый конфиг**.
- Прочее: `--api.insecure=true` (дашборд/API опубликован на 0.0.0.0:8080 хоста!), entrypoints web→websecure редирект, certresolver `mytlschallenge`.

**Шаг 0.3. Подтверждение через API Traefik** (`/api/http/routers`, `/api/http/services`):
- Роутеры: `imagetransformation@file`, `ritualretouch@file`, `upscaler@file`, `upscaler-www@file`, `wellnessworkshop@file`. Сервисов `@docker` нет — источник подтверждён документально.

**Шаг 0.4. Живой конфиг старого домена** (`cat /opt/traefik-dynamic/imagetransformation.yml`):
- Упрощённая версия репозиторной копии: ОДИН роутер без www/middleware, service → `http://imagetransformationtgbot_ts:8080`. Каталог принадлежит root → правки через `sudo`.

**Шаг 0.5. acme.json**: по ожидавшемуся пути файла нет (том называется иначе) — пропущено как некритичное: новые сертификаты выпустит `mytlschallenge` автоматически при добавлении роутеров.

**ВЫВОД (Решение 1 закрыто):**
- Единственный рабочий источник = каталог **`/opt/traefik-dynamic/*.yml`**;
- Новые роутеры шести доменов → новый файл **`/opt/traefik-dynamic/portret-domains.yml`** (один service + шесть Host-роутеров);
- Старый `/opt/traefik-dynamic/imagetransformation.yml` удаляется на шаге 5 вечера D0;
- Мёртвые labels бота удаляются при чистке репозитория (Этап 8).

---

### ⚠️ ВНЕПЛАНОВАЯ НАХОДКА (требует решения владельца до вечера D0)

Контейнер бота **`imagetransformationtgbot_ts` ОТСУТСТВУЕТ** — не запущен ~21 час. В наличии:
- `imagetransformationtgbot_ts_rollback_20260821` — Exited (137), остановлен 21 ч назад (похоже на откат вчерашнего деплоя переименованием);
- `postgre_imagetransformer_ts` — работает (база жива).

⇒ Сайт imagetransformation.ru сейчас отдаёт 502 от Traefik. Возможные причины остановки мне неизвестны. **Вопрос:** поднимать текущую версию (`docker start imagetransformationtgbot_ts_rollback_20260821`) или сразу готовить новую? До ответа прод-действий с контейнером не предпринимаю.

---

---

### [22.08.2026] Этап 1 — Конфигурация доменов в коде → ✅ ВЫПОЛНЕНО

- ✅ Создан `src/domains.ts`: `MAIN_HOST`, `MAIN_ORIGIN`, `DOMAIN_ROUTES` (6 записей host→landingFile), `KNOWN_HOSTS`, `normalizeHost()` (lower-case, отрезание порта, поддержка `[::1]`), `classifyHost()` → `main | landing | local | unknown`, `selfOriginOf()`.
- ✅ `src/config.ts:41` — дефолт `WEBAPP_URL` изменён на `https://portret-iz-foto-ai.ru` (имя переменной сохранено по Решению 8).
- ✅ `.env.example` — то же значение.
- ℹ️ Серверный `.env` сознательно НЕ трогаю до вечера D0: старый код при перезапуске должен продолжать ссылаться на рабочий домен (сейчас это особенно актуально — бот остановлен).
- 📌 Уточнение реализации плейсхолдеров (отклонение от буквальной формулировки Решения 8, зафиксировано): вместо композитного `{{CTA_APP}}` вводятся атомарные `{{SELF_URL}}`, `{{HOST}}`, `{{MAIN_ORIGIN}}` — CTA собирается в самом HTML как `{{MAIN_ORIGIN}}/app/?example=<slug>&utm_source={{HOST}}&utm_medium=landing`. Причина: у каждого лендинга свой `example=`-слаг, композит не выражает это без параметров.
- 🔧 Попутно обнаружено и учтено: `Dockerfile` копирует только `static/` — добавлена доставка `content/` (правка в Этапе 2); healthcheck контейнера бьёт в `127.0.0.1:8080/` — dev-fallback из Решения 6 сохранит его зелёным (Host `127.0.0.1` → классифицируется как local → главная → 200).
- 🔎 В `frontend/public/robots.txt` найден старый домен в строке Sitemap — добавлено в чистку Этапа 8.

---

---

### Остаток Этапа 0 (задачи владельца)

- [ ] Купить/делегировать домены `portret-iz-foto-ai.ru` + 5 тематических, A-записи на IP сервера.
- [ ] Создать ящик `hello@portret-iz-foto-ai.ru`, настроить MX/SPF/DKIM/DMARC.

---

### [22.08.2026] Этап 2 — Перестройка каталогов → ✅ ВЫПОЛНЕНО

- `content/site/` — 8 HTML-страниц (git mv, история сохранена); `oferta/privacy/pay_yookassa/admin.html` → `content/`.
- `static/` теперь содержит ТОЛЬКО ассеты: `favicon.ico`, `site.css` (перенос из static/site/), Bing/Yandex verification-файлы (уйдут на чистке D1).
- `static/robots.txt` и `static/sitemap.xml` удалены — **уточнение реализации Решения 7**: вместо физических шаблонов в `content/` они генерируются кодом в `webServer.ts` (меньше файлов, та же функциональность).
- `Dockerfile`: добавлен `COPY content ./content` в builder- и runtime-стадии.

---

### [22.08.2026] Этап 3 — Маршрутизация Fastify → ✅ ВЫПОЛНЕНО (`tsc` EXIT=0)

- Импорты: `node:fs`, типы Fastify, модуль `./domains.js`; `CONTENT_DIR`; `ASSET_PATHS` (рекурсивный обход `static/` при старте — белый список ассетов для тематических доменов); `TRUST_PROXY` (env, дефолт `loopback,10/8,172.16/12,192.168/16`, `none` отключает) → передан в `Fastify({trustProxy})`.
- **Host-gate onRequest-хук** (зарегистрирован до всех маршрутов): `unknown` → 404 plain; `landing` → только `/`, `/robots.txt`, `/sitemap.xml` + ассеты из белого списка; `main|local` → полный доступ.
- Рендеринг: `readContent/rendered/pageContext`, кэш по ключу `selfOrigin::path`, плейсхолдеры `{{SELF_URL}}/{{SELF_ORIGIN}}/{{MAIN_ORIGIN}}/{{APP_ORIGIN}}/{{HOST}}`, неизвестный плейсхолдер → warn+пусто.
- `GET /` — выбор файла по `classifyHost` (landing → свой файл; main/local → index).
- `singlePages` (oferta, privacy, o-servise, kak-polzovatsya, pay_yookassa, admin) читаются из `content/`; **ngrok-заголовки удалены** (Решение 6).
- `/robots.txt` и `/sitemap.xml` генерируются по Host: landing → `Disallow: /` + 1 URL себя; main → прежние правила + sitemap из 5 URL.
- notFound-handler: двойная защита (unknown/landing → 404), SPA-fallback только для `/app/*`.
- Старые пути лендингов НЕ зарегистрированы → отдают 404 на основном домене (Решение 3).

---

### [22.08.2026] Этап 4 — Шаблоны страниц → ✅ ВЫПОЛНЕНО

Скрипт `transform_content.py` (прогнан один раз, 12 файлов):
- Профиль **LANDING** (5 лендингов): canonical/og:url → `{{SELF_URL}}/`; breadcrumbs и JSON-LD → `{{SELF_URL}}`; изображения примеров → `{{MAIN_ORIGIN}}/app/images/…`; CTA → `{{MAIN_ORIGIN}}/app/?example=…&utm_source={{HOST}}&utm_medium=landing`; ссылки на юридику/инструкцию → `{{MAIN_ORIGIN}}/…`; кросс-ссылки на другие лендинги → литеральные корни новых доменов. Итого 18–22 плейсхолдера на файл.
- Профили **MAIN/MAIN_INFO/LEGAL**: литеральные адреса `https://portret-iz-foto-ai.ru` (плейсхолдеры запрещены — страницы отдаются raw), canonical каждой странице с её путём.
- Общее: счётчики Метрики удалены (script+noscript), `/site/site.css` → `/site.css`, e-mail заменён.
- Контроль: `grep content/` → `imagetransformation.ru`=0, `mc.yandex`=0, `ngrok-skip`=0 ✓.
- **Дополнительно найдено и исправлено:** `frontend/index.html` содержал собственный блок Метрики (4 вхождения) и 2× старый e-mail — очищен, `vite build` перезапущен; `frontend/public/robots.txt` — Sitemap переведён на новый домен.

---

### [22.08.2026] Этап 5 — Почта и контакты → ✅ ВЫПОЛНЕНО (кодовая часть)

- `src/email.ts`: строка `bcc: "hello@ritual-retouch.ru"` удалена.
- `hello@portret-iz-foto-ai.ru` — во всех файлах `content/` и `frontend/index.html`; grep по репозиторию `ritual-retouch` в src/content/frontend/compose — 0 вхождений.
- На стороне владельца в вечер D0: создать ящик, MX/SPF/DKIM/DMARC, `SMTP_FROM` в серверном `.env`.

---

### [22.08.2026] Этап 6 — Локальная верификация → ✅ ВЫПОЛНЕНО (21/21 PASS)

- Сборка: `yarn build` (tsc) и `yarn build:frontend` (vite) — успешно; `frontend-dist` пересобран.
- Харнесс: `scripts/host-matrix.mts` (tsx, заглушка Bot, порт 8099, dummy-env; БД/Telegram не затрагиваются).
- Curl-матрица — **21 PASS / 0 FAIL**, включая: канониклы обоих профилей; отсутствие утечки плейсхолдеров; dev-fallback localhost; блокировки на тематическом домене (`/admin`, `/api/*`, `/uploads/*`, `/oferta` → 404); доступность ассетов; оба варианта robots/sitemap; 404 на старых путях и неизвестном Host; 308 `/app` → `/app/`; SPA 200 без Метрики; оферта с новым доменом; webhook отвечает <500; абсолютные ссылки картинок ×2.
- Примечание: первые два «FAIL» были ошибкой самого теста (паттерн без кавычки `rel="canonical"`), что подтверждено живой диагностикой ответа — код маршрутизации был верен с первого прогона.

---

### [22.08.2026] Этап 7 (часть 1) — DNS, роутеры, деплой, прод-smoke → 🔄 В РАБОТЕ

**DNS:** 5/6 доменов резолвятся в 145.223.96.83 ✓. **`raskrasitfoto-ai.ru` — записи нет** даже на публичных 1.1.1.1/8.8.8.8 → владельцу проверить написание домена/A-запись у регистратора; сертификат для него выпустится автоматически после появления DNS (роутер уже активен).

**Traefik:** создан `/opt/traefik-dynamic/portret-domains.yml` — 6 Host-роутеров + один service `portret-bot → http://imagetransformationtgbot_ts:8080`. File-provider подхватил мгновенно, все роутеры `enabled` (проверено через API). Сертификаты Let's Encrypt выпущены по TLS-challenge (подтверждено успешными HTTPS-запросами).

**Деплой:** ветка `change-domain-name` влита в `main` (--ff-only, HEAD 657a2c5) → серверный `.env`: `WEBAPP_URL=https://portret-iz-foto-ai.ru` (`SMTP_FROM` сознательно старый до создания ящика) → `docker compose build bot` → `up -d bot`: контейнер **running/healthy**, healthcheck 200 (спас dev-fallback).

**Прод-smoke (`scripts/prod-smoke.sh`) — все проверки зелёные:**
- gruppovoe/restavraciya/semeynoe/delovoy-portret `-*.ru`: 200, canonical = собственный домен, утечек старого домена/плейсхолдеров = 0, robots `Disallow: /`;
- portret-iz-foto-ai.ru: canonical ✓, robots c `Disallow: /app/` + Sitemap, sitemap = 5 URL, `/app/` 200 + ассеты, старый путь `/uluchshit-gruppovoe-foto` → 404, оферта 200 с новым доменом;
- старый `imagetransformation.ru`: переходно 200 (отдаёт новый контент) — **удаление роутера/DNS/MX только после ваших переключений и подтверждения** (шаг 5 Решения 12).

**Ждёт владельца для завершения D0:**
1. DNS для `raskrasitfoto-ai.ru`.
2. Telegram BotFather: домен WebApp → `portret-iz-foto-ai.ru`, Menu Button.
3. ЮKassa: webhook → `https://portret-iz-foto-ai.ru/yookassa/webhook`, тестовый платёж до зачисления.
4. Ящик `hello@portret-iz-foto-ai.ru` + MX/SPF/DKIM/DMARC → сообщить, я обновлю `SMTP_FROM` в `.env`.
5. После 1–4 и живой проверки оплаты — подтверждение, и я удаляю старый домен из Traefik (DNS/MX у регистратора удаляете вы).

---

> ➡️ **Продолжение работ (другая сессия):** см. `HANDOFF_MIGRATION.md` — текущее состояние, чеклист оставшихся шагов 4.1–4.12, диагностика и предупреждения.

### [22.08.2026] Фиксация в git


- `f1664ea` — feat: Telegram через tinyproxy — незакоммиченные изменения владельца (compose env, https-proxy-agent, src/index.ts) оформлены отдельным коммитом.
- `cbf53de` — вся миграция (Этапы 1–6): исходники, content/, Dockerfile, планы, ревизия, журнал, curl-харнесс.
- Ветка **`change-domain-name`**, пока только локально. **Push в GitHub и merge в main — за владельцем**; затем вечер D0 по чеклисту Этапа 7 плана.

---

