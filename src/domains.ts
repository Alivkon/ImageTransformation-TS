// Единый источник правды по доменам публичных страниц (Решение 8 плана миграции).
// Добавление нового лендинга = одна запись в DOMAIN_ROUTES + HTML-файл в content/site/.
// Никакие другие модули не должны хардкодить адреса тематических доменов.

export const MAIN_HOST = "portret-iz-foto-ai.ru";
export const MAIN_ORIGIN = `https://${MAIN_HOST}`;

export interface DomainRoute {
  /** Хост в нижнем регистре, без порта и без www */
  host: string;
  /** Путь файла лендинга относительно каталога content/ */
  landingFile: string;
}

/**
 * Тематические домены → назначенная страница.
 * Основной домен обслуживает приложение/API/юридику и главную страницу.
 */
export const DOMAIN_ROUTES: DomainRoute[] = [
  { host: "portret-iz-foto-ai.ru", landingFile: "site/index.html" },
  { host: "raskrasitfoto-ai.ru", landingFile: "site/raskrasit-cherno-beloe-foto.html" },
  { host: "restavraciyafoto-ai.ru", landingFile: "site/restavraciya-staryh-foto.html" },
  { host: "semeynoe-foto-ai.ru", landingFile: "site/zhivopisnyy-portret-kak-podarok-na-yubiley.html" },
  { host: "gruppovoe-foto.ru", landingFile: "site/uluchshit-gruppovoe-foto.html" },
  { host: "delovoy-portret-ai.ru", landingFile: "site/delovoy-portret-iz-foto.html" },
];

/** Все известные приложению хосты (основной + тематические). */
export const KNOWN_HOSTS: ReadonlySet<string> = new Set(DOMAIN_ROUTES.map((r) => r.host));

/** Локальные хосты для разработки (Решение 6): отвечают как основной домен. */
const LOCAL_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Нормализует заголовок Host: lower-case, отрезает порт. null — заголовка нет. */
export function normalizeHost(rawHost: string | undefined): string | null {
  if (!rawHost) return null;
  let host = rawHost.trim().toLowerCase();
  if (host.startsWith("[")) {
    // [::1]:8080 → [::1]
    const end = host.indexOf("]");
    return end === -1 ? host : host.slice(0, end + 1);
  }
  const colon = host.indexOf(":");
  if (colon !== -1) host = host.slice(0, colon);
  return host === "" ? null : host;
}

export type HostClassification =
  | { kind: "main"; host: string }
  | { kind: "landing"; host: string; route: DomainRoute }
  | { kind: "local"; host: string }
  | { kind: "unknown"; host: string | null };

/** Классифицирует входящий запрос по заголовку Host (ядро host-маршрутизации). */
export function classifyHost(rawHost: string | undefined): HostClassification {
  const host = normalizeHost(rawHost);
  if (host === null) return { kind: "unknown", host: null };
  if (host === MAIN_HOST) return { kind: "main", host };
  const route = DOMAIN_ROUTES.find((r) => r.host === host);
  if (route) return { kind: "landing", host, route };
  if (LOCAL_HOSTS.has(host)) return { kind: "local", host };
  return { kind: "unknown", host };
}

/** Origin текущего хоста для плейсхолдера {{SELF_URL}}. unknown → пустая строка. */
export function selfOriginOf(classification: HostClassification): string {
  switch (classification.kind) {
    case "main":
    case "local":
      return MAIN_ORIGIN; // локальная отладка смотрит на контент основного домена
    case "landing":
      return `https://${classification.host}`;
    default:
      return "";
  }
}
