#!/usr/bin/env bash
# Локальный запуск проекта на хосте (не в контейнере).
#
# Бот поднимается на хосте, а не через docker-compose.local.yml, потому что на этой
# машине ufw режет FORWARD для docker-мостов и контейнеры остаются без сети.
# В контейнере крутится только Postgres — он виден с хоста как localhost:5432.

set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

ENV_FILE=".env.local"
COMPOSE_FILE="docker-compose.local.yml"
PG_CONTAINER="postgres_imagetransformer_local"
PID_FILE=".run.pid"
LOG_FILE="run.log"

[[ -f "$ENV_FILE" ]] || { echo "Нет $ENV_FILE — скопируйте .env.local.example и заполните"; exit 1; }

# Значение из .env.local без экспорта всего файла (там есть секреты и пробелы).
env_value() {
  sed -nE "s/^$1=[[:space:]]*//p" "$ENV_FILE" | head -1 | tr -d '"'"'"'\r'
}

PORT="$(env_value WEB_SERVER_PORT)"; PORT="${PORT:-8080}"

# В .env.local хост базы — имя контейнера (postgres), с хоста она доступна как localhost.
db_url() {
  local url; url="$(env_value DATABASE_URL)"
  [[ -n "$url" ]] || { echo "DATABASE_URL не задан в $ENV_FILE" >&2; exit 1; }
  echo "${url/@postgres:/@localhost:}"
}

running_pid() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid; pid="$(cat "$PID_FILE")"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null || return 1
  echo "$pid"
}

ensure_postgres() {
  if ! docker ps --format '{{.Names}}' | grep -qx "$PG_CONTAINER"; then
    echo "Поднимаю Postgres..."
    docker compose -f "$COMPOSE_FILE" up -d postgres
    # Ждём healthcheck, иначе initDb упадёт на старте.
    for _ in $(seq 1 30); do
      [[ "$(docker inspect -f '{{.State.Health.Status}}' "$PG_CONTAINER" 2>/dev/null)" == "healthy" ]] && return 0
      sleep 1
    done
    echo "Postgres не стал healthy за 30с" >&2; exit 1
  fi
}

cmd_build() {
  yarn build
  yarn build:frontend
}

cmd_start() {
  if pid="$(running_pid)"; then
    echo "Уже запущено (pid $pid), http://localhost:$PORT"
    return 0
  fi
  [[ -f dist/index.js ]] || cmd_build
  ensure_postgres

  DATABASE_URL="$(db_url)" nohup node dist/index.js >"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"

  for _ in $(seq 1 20); do
    sleep 0.5
    if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "Процесс упал на старте, последние строки $LOG_FILE:" >&2
      tail -20 "$LOG_FILE" >&2; rm -f "$PID_FILE"; exit 1
    fi
    if curl -sf -o /dev/null --max-time 2 "http://localhost:$PORT/"; then
      echo "Запущено (pid $(cat "$PID_FILE")), http://localhost:$PORT, лог: $LOG_FILE"
      return 0
    fi
  done
  echo "Порт $PORT не ответил за 10с — смотрите $LOG_FILE" >&2; exit 1
}

cmd_stop() {
  if pid="$(running_pid)"; then
    kill "$pid"
    for _ in $(seq 1 20); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.5
    done
    kill -9 "$pid" 2>/dev/null || true
    echo "Остановлено (pid $pid)"
  else
    echo "Не запущено"
  fi
  rm -f "$PID_FILE"
}

cmd_status() {
  if pid="$(running_pid)"; then
    local code; code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://localhost:$PORT/" || echo "нет ответа")"
    echo "Запущено: pid $pid, порт $PORT, HTTP $code"
  else
    echo "Не запущено"
  fi
  local pg; pg="$(docker inspect -f '{{.State.Status}}' "$PG_CONTAINER" 2>/dev/null || echo "нет контейнера")"
  echo "Postgres ($PG_CONTAINER): $pg"
}

case "${1:-}" in
  start)   cmd_start ;;
  stop)    cmd_stop ;;
  restart) cmd_stop; cmd_start ;;
  build)   cmd_build ;;
  rebuild) cmd_stop; cmd_build; cmd_start ;;
  status)  cmd_status ;;
  logs)    tail -f "$LOG_FILE" ;;
  *)
    echo "Использование: $0 {start|stop|restart|build|rebuild|status|logs}"
    echo
    echo "  start    запустить (соберёт, если нет dist/, и поднимет Postgres)"
    echo "  stop     остановить"
    echo "  restart  перезапустить без пересборки"
    echo "  build    yarn build + yarn build:frontend"
    echo "  rebuild  пересобрать и перезапустить — после правок кода"
    echo "  status   что сейчас работает"
    echo "  logs     tail -f $LOG_FILE"
    exit 1 ;;
esac
