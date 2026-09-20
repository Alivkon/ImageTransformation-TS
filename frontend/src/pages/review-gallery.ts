import { getReviewGenerations } from "../api.js";
import { notifications } from "../components/notifications.js";
import type { ReviewGeneration } from "../types.js";

let currentPage = 0;
let loading = false;
let hasMore = true;
let initialized = false;

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[
        char
      ] ?? char,
  );
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function userLabel(item: ReviewGeneration): string {
  if (!item.metadata_available) return "Архивный файл · пользователь не найден в БД";
  if (item.user.email) return item.user.email;
  const username = item.user.telegram_username
    ? `@${item.user.telegram_username}`
    : "без username";
  return `${username} · ID ${item.user.telegram_id ?? "неизвестен"}`;
}

function card(item: ReviewGeneration): string {
  const itemLabel = item.id === null ? "Архив" : `#${item.id}`;
  const prompt = item.prompt || "Описание не сохранилось";
  return `
    <article class="review-card">
      <div class="review-card-head">
        <div>
          <div class="review-user">${escapeHtml(userLabel(item))}</div>
          <div class="review-date">${escapeHtml(formatDate(item.created_at))}</div>
        </div>
        <span class="review-id">${itemLabel}</span>
      </div>
      <div class="review-pair">
        <figure>
          <figcaption>Было</figcaption>
          <button type="button" class="review-image-button" data-review-image="${item.source_url}" aria-label="Открыть исходное изображение">
            <img src="${item.source_url}" alt="Исходное изображение" loading="lazy">
          </button>
        </figure>
        <figure>
          <figcaption>Стало</figcaption>
          <button type="button" class="review-image-button" data-review-image="${item.result_url}" aria-label="Открыть результат">
            <img src="${item.result_url}" alt="Результат генерации" loading="lazy">
          </button>
        </figure>
      </div>
      <div class="review-prompt">
        <span>Запрос</span>
        <p>${escapeHtml(prompt)}</p>
      </div>
    </article>`;
}

function setupPreview(): void {
  const preview = document.getElementById("review-preview");
  const image = document.getElementById("review-preview-image") as HTMLImageElement | null;
  const closeButton = document.getElementById("review-preview-close") as HTMLButtonElement | null;
  const grid = document.getElementById("review-gallery-grid");
  if (!preview || !image || !closeButton || !grid) return;

  const close = (): void => {
    preview.classList.remove("active");
    preview.setAttribute("aria-hidden", "true");
    image.removeAttribute("src");
    document.body.style.overflow = "";
  };

  grid.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>(
      "[data-review-image]",
    );
    const src = button?.dataset["reviewImage"];
    if (!src) return;

    image.src = src;
    preview.classList.add("active");
    preview.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    closeButton.focus();
  });

  closeButton.addEventListener("click", close);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && preview.classList.contains("active")) close();
  });
}

async function loadNextPage(): Promise<void> {
  if (loading || !hasMore) return;
  const grid = document.getElementById("review-gallery-grid");
  const loadMore = document.getElementById("review-load-more") as HTMLButtonElement | null;
  const empty = document.getElementById("review-empty");
  if (!grid) return;

  loading = true;
  if (loadMore) {
    loadMore.disabled = true;
    loadMore.textContent = "Загрузка...";
  }

  try {
    const response = await getReviewGenerations(currentPage);
    if (currentPage === 0) grid.innerHTML = "";
    grid.insertAdjacentHTML("beforeend", response.items.map(card).join(""));
    currentPage = response.next_page ?? currentPage + 1;
    hasMore = response.has_more;
    if (empty) empty.hidden = response.items.length > 0 || currentPage > 1;
    if (loadMore) loadMore.hidden = !hasMore;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Неизвестная ошибка";
    notifications.error(`Не удалось загрузить служебную галерею: ${message}`);
  } finally {
    loading = false;
    if (loadMore) {
      loadMore.disabled = false;
      loadMore.textContent = "Показать ещё";
    }
  }
}

export async function initReviewGallery(): Promise<void> {
  currentPage = 0;
  hasMore = true;
  const grid = document.getElementById("review-gallery-grid");
  if (grid) grid.innerHTML = "";

  if (!initialized) {
    initialized = true;
    setupPreview();
    document.getElementById("review-load-more")?.addEventListener("click", () => {
      void loadNextPage();
    });
  }

  await loadNextPage();
}
