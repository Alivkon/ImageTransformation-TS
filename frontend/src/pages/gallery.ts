import { getGenerations } from "../api.js";
import type { Generation } from "../types.js";
import { notifications } from "../components/notifications.js";
import { exampleCases } from "../data/example-prompts.js";
import { asset } from "../assets.js";

const EXAMPLE_PROMPT_STORAGE_KEY = "selected_example_prompt";

type Navigate = (page: string) => void;

export function initCompare(): void {
  const overlay = document.getElementById("compare-overlay");
  const container = document.getElementById("compare-container") as HTMLElement | null;
  const imgBefore = document.getElementById("compare-img-before") as HTMLImageElement | null;
  const imgAfter = document.getElementById("compare-img-after") as HTMLImageElement | null;
  const divider = document.getElementById("compare-divider") as HTMLElement | null;
  const closeBtn = document.getElementById("compare-close-btn") as HTMLElement | null;

  if (!overlay || !container || !imgBefore || !imgAfter || !divider || !closeBtn) return;
  if (overlay.dataset["initialized"] === "true") return;
  overlay.dataset["initialized"] = "true";

  let isDragging = false;

  function setSplit(pct: number): void {
    const safePct = Math.max(2, Math.min(98, pct));
    imgBefore.style.clipPath = `inset(0 ${100 - safePct}% 0 0)`;
    divider.style.left = `${safePct}%`;
  }

  function clientXToPct(clientX: number): number {
    const rect = container.getBoundingClientRect();
    return ((clientX - rect.left) / rect.width) * 100;
  }

  function loadImg(img: HTMLImageElement, src: string): Promise<void> {
    return new Promise((resolve) => {
      if (img.src.endsWith(src) && img.complete && img.naturalWidth > 0) {
        resolve();
        return;
      }

      img.onload = () => {
        img.onload = null;
        img.onerror = null;
        resolve();
      };
      img.onerror = () => {
        img.onload = null;
        img.onerror = null;
        resolve();
      };
      img.src = src;
    });
  }

  async function open(beforeSrc: string, afterSrc: string): Promise<void> {
    await Promise.all([loadImg(imgBefore, beforeSrc), loadImg(imgAfter, afterSrc)]);

    const width = imgBefore.naturalWidth || 800;
    const height = imgBefore.naturalHeight || 600;
    const scale = Math.min(window.innerWidth / width, window.innerHeight / height);

    container.style.width = `${Math.round(width * scale)}px`;
    container.style.height = `${Math.round(height * scale)}px`;

    setSplit(50);
    overlay.setAttribute("aria-hidden", "false");
    overlay.classList.add("active");
    document.body.style.overflow = "hidden";
  }

  function close(): void {
    overlay.classList.remove("active");
    overlay.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });

  container.addEventListener("mousedown", (event) => {
    isDragging = true;
    setSplit(clientXToPct(event.clientX));
    event.preventDefault();
  });
  window.addEventListener("mousemove", (event) => {
    if (isDragging) setSplit(clientXToPct(event.clientX));
  });
  window.addEventListener("mouseup", () => {
    isDragging = false;
  });

  container.addEventListener("touchstart", (event) => {
    isDragging = true;
    setSplit(clientXToPct(event.touches[0].clientX));
  }, { passive: true });
  window.addEventListener("touchmove", (event) => {
    if (isDragging) setSplit(clientXToPct(event.touches[0].clientX));
  }, { passive: true });
  window.addEventListener("touchend", () => {
    isDragging = false;
  });

  document.addEventListener("click", (event) => {
    if ((event.target as HTMLElement | null)?.closest(".example-prompt-btn")) return;

    const card = (event.target as HTMLElement | null)?.closest<HTMLElement>(".before-after-card");
    if (!card) return;

    // в карточке лежат превью, поэтому полноразмерные пути берём из data-атрибутов
    const before = card.dataset["fullBefore"];
    const after = card.dataset["fullAfter"];
    if (before && after) void open(before, after);
  });
}

let currentPage = 0;
let allLoaded = false;
let currentQuery = "";
let currentDateFilter = "";
let listenersAttached = false;
let exampleListenersAttached = false;

export async function initGallery(navigate: Navigate, canLoadGenerations: boolean): Promise<void> {
  currentPage = 0;
  allLoaded = false;
  currentQuery = "";
  currentDateFilter = "";
  renderExampleCases();

  const grid = document.getElementById("gallery-grid");
  if (grid) grid.innerHTML = "";

  const searchEl = document.getElementById("gallery-search") as HTMLInputElement | null;
  const filterEl = document.getElementById("gallery-filter") as HTMLSelectElement | null;
  if (searchEl) searchEl.value = "";
  if (filterEl) filterEl.value = "";

  if (canLoadGenerations) {
    await loadPage();
  } else if (grid) {
    grid.innerHTML = `
      <div class="gallery-empty">
        <p>Авторизуйтесь, чтобы видеть свои генерации</p>
      </div>`;
  }

  if (!listenersAttached) {
    listenersAttached = true;

    searchEl?.addEventListener("input", (e) => {
      currentQuery = (e.target as HTMLInputElement).value.toLowerCase();
      filterItems();
    });

    filterEl?.addEventListener("change", (e) => {
      currentDateFilter = (e.target as HTMLSelectElement).value;
      filterItems();
    });
  }

  if (!exampleListenersAttached) {
    exampleListenersAttached = true;
    document.getElementById("example-cases-grid")?.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>(".example-prompt-btn");
      if (!button) return;

      event.preventDefault();
      event.stopPropagation();

      const prompt = button.dataset["prompt"]?.trim();
      if (!prompt) return;

      sessionStorage.setItem(EXAMPLE_PROMPT_STORAGE_KEY, prompt);
      navigate("generate");
    });
  }
}

// Тот же канал, что и у кнопки «Взять промпт» в галерее, — им пользуются публичные
// страницы сайта, приводя пользователя сразу на генерацию с заполненным описанием.
export function setSelectedExamplePrompt(prompt: string): void {
  sessionStorage.setItem(EXAMPLE_PROMPT_STORAGE_KEY, prompt);
}

export function getSelectedExamplePrompt(): string | null {
  const prompt = sessionStorage.getItem(EXAMPLE_PROMPT_STORAGE_KEY);
  if (!prompt) return null;
  sessionStorage.removeItem(EXAMPLE_PROMPT_STORAGE_KEY);
  return prompt;
}

async function loadPage(): Promise<void> {
  const grid = document.getElementById("gallery-grid");
  if (!grid || allLoaded) return;

  try {
    const gens = await getGenerations(currentPage, 20);
    if (gens.length < 20) allLoaded = true;
    if (gens.length === 0 && currentPage === 0) {
      grid.innerHTML = `
        <div class="gallery-empty">
          <p>📸 Галерея пуста</p>
          <button class="btn btn-primary" id="go-generate-btn">Начните генерацию</button>
        </div>`;
      return;
    }

    gens.forEach((g) => grid.appendChild(buildCard(g)));
    currentPage++;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Ошибка";
    notifications.error(`Не удалось загрузить галерею: ${msg}`);
  }
}

function buildCard(g: Generation): HTMLElement {
  const card = document.createElement("div");
  card.className = "gallery-item";
  card.dataset["status"] = g.status;
  card.dataset["prompt"] = g.prompt.toLowerCase();
  card.dataset["date"] = g.created_at;

  if (g.status === "completed" && g.result_file_id && g.result_file_id.startsWith("/uploads/")) {
    card.innerHTML = `
      <img src="${g.result_file_id}" alt="Result" loading="lazy">
      <div class="gallery-overlay">
        <div class="gallery-prompt">${escapeHtml(g.prompt.slice(0, 60))}…</div>
        <div class="gallery-meta">${formatDate(g.created_at)}</div>
      </div>`;
  } else {
    const icon = g.status === "processing" ? "⏳" : "❌";
    card.innerHTML = `
      <div class="gallery-status-card">
        <div class="gallery-status-icon">${icon}</div>
        <div class="gallery-prompt">${escapeHtml(g.prompt.slice(0, 60))}</div>
        <div class="gallery-meta">${formatDate(g.created_at)}</div>
      </div>`;
  }

  return card;
}

function renderExampleCases(): void {
  const grid = document.getElementById("example-cases-grid");
  if (!grid) return;

  grid.innerHTML = exampleCases.map((item) => `
    <div
      class="before-after-card"
      data-example-id="${item.id}"
      data-full-before="${asset(item.beforeImage)}"
      data-full-after="${asset(item.afterImage)}"
    >
      <div class="gallery-case-pair">
        <div class="case-image-wrap">
          <div class="case-label">До</div>
          <img class="case-img" src="${asset(item.beforeThumb)}" alt="До: ${escapeHtml(item.title)}" loading="lazy">
        </div>
        <div class="case-image-wrap">
          <div class="case-label">После</div>
          <img class="case-img" src="${asset(item.afterThumb)}" alt="После: ${escapeHtml(item.title)}" loading="lazy">
        </div>
      </div>
      <div class="case-card-footer">
        <div class="case-caption">${escapeHtml(item.title)}</div>
        <button
          type="button"
          class="btn btn-secondary btn-sm example-prompt-btn"
          data-prompt="${escapeHtmlAttr(item.prompt)}"
        >
          Посмотреть промт
        </button>
      </div>
    </div>
  `).join("");
}

function filterItems(): void {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(startOfDay);
  startOfWeek.setDate(startOfDay.getDate() - startOfDay.getDay());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  document.querySelectorAll<HTMLElement>(".gallery-item").forEach((item) => {
    const prompt = item.dataset["prompt"] ?? "";
    const dateStr = item.dataset["date"] ?? "";

    const matchesQuery = !currentQuery || prompt.includes(currentQuery);

    let matchesDate = true;
    if (currentDateFilter && dateStr) {
      const created = new Date(dateStr);
      if (currentDateFilter === "today") matchesDate = created >= startOfDay;
      else if (currentDateFilter === "week") matchesDate = created >= startOfWeek;
      else if (currentDateFilter === "month") matchesDate = created >= startOfMonth;
    }

    item.style.display = matchesQuery && matchesDate ? "" : "none";
  });
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c] ?? c));
}

function escapeHtmlAttr(s: string): string {
  return escapeHtml(s).replace(/\n/g, "&#10;");
}
