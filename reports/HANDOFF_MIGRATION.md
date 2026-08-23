# HANDOFF — продолжение миграции доменов (для новой сессии)

> **Прочти меня первым.** Дата фиксации: 22.08.2026, вечер D0 выполнен частично.
> Этот документ — точка входа для продолжения работ. Порядок чтения:
> 1) этот файл → 2) `EXECUTION_LOG.md` (что уже сделано) → 3) `DOMAIN_MIGRATION_EXECUTION_PLAN.md` (12 принятых решений).

## 1. Что за проект и что происходит

ImageTransformationTGBot-TS (`/opt/bots/ImageTransformationTGBot-TS`) — Telegram-бот + Fastify-сервер + SPA.
Миграция: уход с `imagetransformation.ru`, раскладка шести доменов на один контейнер через host-маршрутизацию.
**Все решения зафиксированы** в `DOMAIN_MIGRATION_EXECUTION_PLAN.md` (Журнал решений №1–12) — не менять их без владельца.

## 2. Текущее состояние продакшна (проверено 22.08 вечером)

| Домен | Состояние |
|---|---|
| `portret-iz-foto-ai.ru` | ✅ ЖИВОЙ: лендинг, `/app/` SPA, robots/sitemap, оферта. Cert LE выпущен |
| `gruppovoe-foto.ru` | ✅ ЖИВОЙ (лендинг) |
| `restavraciyafoto-ai.ru` | ✅ ЖИВОЙ |
| `semeynoe-foto-ai.ru` | ✅ ЖИВОЙ |
| `delovoy-portret-ai.ru` | ✅ ЖИВОЙ |
| `raskrasitfoto-ai.ru` | ❌ **DNS-записи нет вообще** (даже на 1.1.1.1). Роутер в Traefik активен — сертификат выдастся сам после появления DNS |
| `imagetransformation.ru` | ✅ **Удалён с этого сервера 23.08.2026**: роутер `/opt/traefik-dynamic/imagetransformation.yml` снят, запросы LE-сертификата прекращены; DNS ведёт на 81.177.160.165 (другой сервер). Бэкап роутера: `/root/imagetransformation.yml.removed-20260823.bak`. Остались шаги владельца 4.3/4.8 |

Инфраструктура: контейнер `imagetransformationtgbot_ts` running/**healthy** (новый образ собран и запущен).
Traefik — контейнер `n8n-traefik-1`, конфиги в `/opt/traefik-dynamic/*.yml` (правки через sudo):
живой источник ТОЛЬКО он; labels в docker-compose.yml бота мертвы (docker-provider выключен).

## 3. Где что лежит

| Артефакт | Путь |
|---|---|
| Рабочий план (12 решений) | `DOMAIN_MIGRATION_EXECUTION_PLAN.md` |
| Журнал выполненных шагов | `EXECUTION_LOG.md` |
| Ревизия рисков базового плана | `PLAN_REVIEW_REPORT.html` |
| Хост-конфиг доменов (код) | `src/domains.ts` |
| Маршрутизация | `src/webServer.ts` (host-gate хук, плейсхолдеры `{{SELF_URL}}/{{MAIN_ORIGIN}}/{{HOST}}`) |
| HTML страниц (приватные!) | `content/site/*.html`, `content/{oferta,privacy,pay_yookassa,admin}.html` |
| Публичные ассеты | `static/` (favicon, site.css, верификация Bing/Яндекс) |
| Прод-smoke скрипт | `scripts/prod-smoke.sh` (bash, без аргументов) |
| Локальный харнесс маршрутизации | `scripts/host-matrix.mts` (порт 8099) |
| Traefik: новые роутеры | `/opt/traefik-dynamic/portret-domains.yml` |
| Traefik: СТАРЫЙ роутер | ~~`/opt/traefik-dynamic/imagetransformation.yml`~~ удалён с сервера 23.08.2026, бэкап в `/root/imagetransformation.yml.removed-20260823.bak`; мёртвая копия из `deploy/` тоже удалена (шаг 4.9) |
| Git | `main` @ d7dae9a (+ ветка change-domain-name, слита). **НЕ ЗАПУШЕНО в GitHub!** |

## 4. ЧЕКЛИСТ ОСТАВШИХСЯ ШАГОВ (по порядку)

### Владелец
- [ ] **4.1.** DNS `raskrasitfoto-ai.ru`: A-запись → `145.223.96.83` (или сверить написание домена).
- [ ] **4.2.** Telegram BotFather → Bot Settings → Domain: `portret-iz-foto-ai.ru`; обновить Menu Button.
      ⚠️ Приоритетно: кнопки WebApp в боте уже ведут на новый домен, но без записи в BotFather клиент может отказаться открывать.
- [ ] **4.3.** Кабинет ЮKassa → webhook: `https://portret-iz-foto-ai.ru/yookassa/webhook`.
      Пока webhook старый — он продолжает работать (старый домен жив), платежи НЕ теряются. Тестовый платёж делать после переключения.
- [ ] **4.4.** Почтовый ящик `hello@portret-iz-foto-ai.ru` + MX/SPF/DKIM/DMARC у провайдера почты.

### Агент (новая сессия) — после каждого пункта владельца
- [ ] **4.5.** После 4.1: `getent hosts raskrasitfoto-ai.ru` → дождаться IP → `curl -s https://raskrasitfoto-ai.ru/` (cert выдастся автоматически) → прогнать `bash scripts/prod-smoke.sh`.
- [ ] **4.6.** После 4.4: в серверном `.env` заменить `SMTP_FROM=hello@imagetransformation.ru` → `hello@portret-iz-foto-ai.ru` (строка ~50), затем `sudo docker compose up -d bot` (без rebuild — env читается на старте). Отправить тестовое письмо подтверждения, проверить доставку и ссылку.
- [x] **4.7.** ✅ Выполнено 23.08.2026: `/opt/traefik-dynamic/imagetransformation.yml` удалён (бэкап `/root/imagetransformation.yml.removed-20260823.bak`), Traefik API подтверждает отсутствие роутера, новые домены живы. Подробности — `EXECUTION_LOG.md`.
- [ ] **4.8.** Владелец у регистратора: удалить A-запись и MX `imagetransformation.ru`.

### Этап 8 — чистка (после удаления старого домена)
- [ ] **4.9.** Репозиторий: удалить `deploy/traefik/dynamic/imagetransformation.yml` (мёртвая копия), мёртвые traefik-labels из `docker-compose.yml` (~строки 50–57), старые верификационные файлы `'BingSiteAuth .xml'` и `yandex_af11eab875ed4358.html` из `static/`, корневой `index.html` и `INTERNATIONAL_SITE_MIGRATION_PLAN.md` (устаревшие артефакты со старым доменом).
- [ ] **4.10.** Контрольная чистота: `grep -rn 'imagetransformation\.ru' --exclude-dir=node_modules --exclude-dir=.git .` → 0 вхождений (`dist/`, `frontend-dist/` уже пересобраны 22.08).
- [ ] **4.11.** Яндекс Вебмастер + Google Search Console: добавить все 6 доменов, подтвердить владение (verification-файлы кладутся в `static/`), отправить sitemap каждого домена.
- [ ] **4.12.** Наблюдение 2–3 дня: `sudo docker logs imagetransformationtgbot_ts --tail 200` (ошибки), платежи в ЮKassa, письма. Итоги записывать в `EXECUTION_LOG.md`.

## 5. Быстрая диагностика при возобновлении сессии

```bash
cd /opt/bots/ImageTransformationTGBot-TS
sudo docker ps --format '{{.Names}}\t{{.Status}}' | grep -E 'tgbot_ts|traefik'
sudo docker inspect imagetransformationtgbot_ts --format '{{.State.Health.Status}}'
bash scripts/prod-smoke.sh          # весь зелёный набор проверок по живым доменам
curl -s http://127.0.0.1:8080/api/http/routers | python3 -m json.tool | grep -E '\"name\"|\"status\"'
```
Ожидаемое: бот healthy; smoke без FAIL; среди роутеров 6× portret-*@file + временно imagetransformation@file (до шага 4.7).

## 6. Важные предупреждения

1. **Точка невозврата** — только шаг 4.7 (файл старого роутера). До него любой откат возможен возвратом образа/`git checkout`. После — только forward-fix (Решение 11).
2. **Исторические ссылки** `imagetransformation.ru/uploads/...` в БД и чатах умрут вместе с доменом — владелец принял (Решение 2), миграции данных НЕТ. Не «чинить» их без новой команды владельца.
3. **Старые пути** (`/uluchshit-gruppovoe-foto` и т.п.) на новом основном домене отдают 404 НАМЕРЕННО (Решение 3) — не добавлять редиректы.
4. **SMTP_FROM** в `.env` пока старый: письма уходят от `hello@imagetransformation.ru` и работают, ПОКА живы старый ящик/MX. После шага 4.4 обязательно сменить (шаг 4.6), иначе после удаления MX письма начнут отбиваться.
5. Бэкапов БД нет (Решение 11) — любые ручные операции с postgres делать осознанно.
6. Коммитить в `main`; перед деплоем всегда `yarn build:all` (tsc + vite), не только `yarn build`.

## 7. Если что-то сломалось

- Откат приложения: предыдущий образ мог остаться в `docker images` под другим IMAGE ID — проверить ДО пересборки; `docker compose build` перезаписал тег `imagetransformationtgbot-ts:latest`.
- 502 на всех доменах → бот упал: `sudo docker logs imagetransformationtgbot_ts --tail 50`.
- 404 на домене, который раньше работал → файл `/opt/traefik-dynamic/portret-domains.yml` на месте? watch не отключён? `curl http://127.0.0.1:8080/api/http/routers`.
- Слетел сертификат одного домена → проверить DNS (`getent hosts <домен>`); LE выдаст сам после появления записи.

