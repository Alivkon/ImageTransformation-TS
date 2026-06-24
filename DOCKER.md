# Docker Setup Guide

Контейнеры для локального тестирования приложения.

## Требования

- Docker (v20.10+)
- Docker Compose (v1.29+)

## Быстрый старт

### 1. Подготовка

```bash
# Скопируйте тестовый .env файл
cp .env.test .env
```

### 2. Запуск контейнеров

```bash
# Собрать и запустить контейнеры
docker-compose up --build

# Или запустить в фоне
docker-compose up -d --build
```

### 3. Проверка статуса

```bash
# Посмотреть статус контейнеров
docker-compose ps

# Посмотреть логи приложения
docker-compose logs -f app

# Посмотреть логи базы данных
docker-compose logs -f postgres
```

## Доступные команды

### Остановка

```bash
# Остановить контейнеры
docker-compose down

# Остановить контейнеры и удалить volumes
docker-compose down -v
```

### Перестройка

```bash
# Перестроить образ приложения
docker-compose build --no-cache app

# Перестроить и запустить
docker-compose up --build app
```

### Работа с базой данных

```bash
# Подключиться к PostgreSQL консоли
docker-compose exec postgres psql -U postgres

# Сделать дамп базы
docker-compose exec postgres pg_dump -U postgres postgres > backup.sql

# Восстановить из дампа
docker-compose exec -T postgres psql -U postgres < backup.sql
```

### Мониторинг логов

```bash
# Все логи
docker-compose logs

# Последние 100 строк
docker-compose logs --tail 100

# Логи в реальном времени
docker-compose logs -f

# Логи конкретного сервиса
docker-compose logs -f app
docker-compose logs -f postgres
```

## Переменные окружения

Переменные задаются в файле `.env`. Основные переменные:

- `BOT_TOKEN` - токен Telegram бота
- `ADMIN_ID` - ID администратора
- `KIE_API_KEY` - API ключ KIE.ai
- `DATABASE_URL` - URL подключения к БД (генерируется автоматически)
- `POSTGRES_PASSWORD` - пароль PostgreSQL

Полный список в `.env.example`.

## Сетевые настройки

- **Приложение**: http://localhost:8080
- **PostgreSQL**: localhost:5432

Для подключения к контейнеру используйте имя сервиса (например, `postgres` вместо `localhost`).

## Возможные проблемы

### Port is already allocated

```bash
# Смените порт в docker-compose.yml
# Или остановите процесс, занимающий порт
docker-compose down
```

### Permission denied

```bash
# Проверьте права на Docker socket
sudo usermod -aG docker $USER
newgrp docker
```

### Container exits immediately

```bash
# Проверьте логи
docker-compose logs app

# Может быть проблема с переменными окружения
# Убедитесь, что .env файл существует и содержит нужные переменные
```

## Отладка

### Вход в контейнер

```bash
# Войти в контейнер приложения
docker-compose exec app sh

# Войти в контейнер БД
docker-compose exec postgres sh
```

### Проверка здоровья

```bash
# Health check для приложения
docker-compose exec app wget -O- http://localhost:8080/health

# Health check для БД
docker-compose exec postgres pg_isready -U postgres
```
