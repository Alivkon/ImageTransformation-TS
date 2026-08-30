# Локальное развёртывание Docker

Этот документ описывает как развёртывать проект локально с использованием Docker Compose.

## Подготовка

### 1. Создайте локальный файл конфигурации

Скопируйте пример конфигурации:

```bash
cp .env.local.example .env.local
```

Отредактируйте `.env.local` и заполните необходимые переменные окружения:

```bash
nano .env.local
```

Обязательные переменные:
- `BOT_TOKEN` — токен вашего Telegram бота
- `ADMIN_ID` — ID администратора в Telegram
- `KIEAI_API_KEY` — API ключ для KieAI сервиса

### 2. Убедитесь, что Docker и Docker Compose установлены

```bash
docker --version
docker compose --version
```

## Запуск

### Первый запуск (сборка образа)

```bash
docker compose -f docker-compose.local.yml up -d
```

Это:
- Соберёт Docker образ приложения
- Запустит PostgreSQL контейнер
- Запустит контейнер бота
- Создаст изолированную локальную сеть

### Проверка статуса

```bash
docker compose -f docker-compose.local.yml ps
```

### Просмотр логов

```bash
# Все сервисы
docker compose -f docker-compose.local.yml logs -f

# Только бот
docker compose -f docker-compose.local.yml logs -f bot

# Только база данных
docker compose -f docker-compose.local.yml logs -f postgres
```

## Разработка

### Пересборка образа после изменений кода

```bash
docker compose -f docker-compose.local.yml build bot
docker compose -f docker-compose.local.yml up -d bot
```

Или в одну команду:

```bash
docker compose -f docker-compose.local.yml up -d --build bot
```

### Входящее в контейнер

```bash
docker compose -f docker-compose.local.yml exec bot sh
```

### Выполнение команд внутри контейнера

```bash
docker compose -f docker-compose.local.yml exec bot yarn build
docker compose -f docker-compose.local.yml exec bot npm list
```

## Доступ к сервисам

- **Веб приложение**: http://localhost:8090
- **PostgreSQL**: localhost:5432
  - Пользователь: `postgres`
  - Пароль: из `.env.local` (POSTGRES_PASSWORD)
  - База данных: `portretizfototgbot`

## Остановка

### Остановить контейнеры (сохранить данные)

```bash
docker compose -f docker-compose.local.yml stop
```

### Остановить и удалить контейнеры (сохранить данные в volume)

```bash
docker compose -f docker-compose.local.yml down
```

### Полная очистка (удалить всё включая данные)

```bash
docker compose -f docker-compose.local.yml down -v
```

## Отличия от production конфигурации

| Параметр | Local | Production |
|----------|-------|-----------|
| Сеть | Локальная (portretizfototgbot_local) | Подключена к n8n_default |
| Портов открыто | Все (8090, 5432) | Только для bot (8080) |
| Proxy | Нет | Traefik |
| SSL/TLS | Нет | Да (с certresolver) |
| Volume монтирование | Да (для разработки) | Нет |
| Restart policy | unless-stopped | unless-stopped |
| Healthcheck | Базовый | Да |

## Проблемы и решения

### Ошибка: "Cannot connect to Docker daemon"

Убедитесь, что Docker запущен:

```bash
sudo systemctl start docker
```

### Ошибка: "Port already in use"

Найдите процесс, занимающий порт:

```bash
sudo lsof -i :8090
sudo lsof -i :5432
```

Или используйте другие портов в `docker-compose.local.yml`:

```yaml
ports:
  - "8091:8090"  # вместо 8090
  - "5433:5432"  # вместо 5432
```

### Database connection refused

Дождитесь полной инициализации PostgreSQL:

```bash
docker compose -f docker-compose.local.yml logs postgres
```

### Изменения кода не применяются

Пересоберите образ:

```bash
docker compose -f docker-compose.local.yml build --no-cache bot
docker compose -f docker-compose.local.yml up -d bot
```

## Переход на production

Используйте стандартный `docker-compose.yml`:

```bash
docker compose up -d
```

Убедитесь, что используете production `.env` файл с правильными переменными окружения.
