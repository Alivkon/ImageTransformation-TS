import { getGenerations } from "../api.js";
import type { Generation } from "../types.js";
import { notifications } from "../components/notifications.js";

let currentPage = 0;
let allLoaded = false;
let currentQuery = "";
let currentDateFilter = "";
let listenersAttached = false;

export async function initGallery(): Promise<void> {
  currentPage = 0;
  allLoaded = false;
  currentQuery = "";
  currentDateFilter = "";

  const grid = document.getElementById("gallery-grid");
  if (grid) grid.innerHTML = "";

  const searchEl = document.getElementById("gallery-search") as HTMLInputElement | null;
  const filterEl = document.getElementById("gallery-filter") as HTMLSelectElement | null;
  if (searchEl) searchEl.value = "";
  if (filterEl) filterEl.value = "";

  await loadPage();

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
