// Счётчик Метрики подключён инлайном в index.html и на переходах внутри SPA
// ничего не считает: URL не меняется, поэтому за визит был бы ровно один просмотр.
// Отправляем виртуальные просмотры сами.

const METRIKA_ID = 111270321;

declare global {
  interface Window {
    ym?: (id: number, action: string, ...args: unknown[]) => void;
  }
}

// Сниппет при инициализации уже отправил хит для текущего URL, поэтому стартовый
// navigate("dashboard") дублем считаться не должен.
let lastUrl = location.href;

export function trackPageView(page: string): void {
  const url = `${location.origin}/app/${page === "dashboard" ? "" : page}`;
  if (url === lastUrl) return;

  const referer = lastUrl;
  lastUrl = url;
  window.ym?.(METRIKA_ID, "hit", url, { title: document.title, referer });
}
