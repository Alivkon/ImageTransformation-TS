// Приложение собирается с base = "/app/", поэтому public-ассеты лежат не в корне сайта,
// а под этим префиксом. В данных (например, example-prompts.ts) пути хранятся от корня
// public-папки — Vite такие строки в коде не переписывает, префикс добавляем сами.
export function asset(publicPath: string): string {
  return import.meta.env.BASE_URL.replace(/\/$/, "") + publicPath;
}
