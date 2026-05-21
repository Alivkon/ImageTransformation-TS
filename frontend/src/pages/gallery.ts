import { getGenerations } from "../api.js";
import type { Generation } from "../types.js";
import { notifications } from "../components/notifications.js";

let currentPage = 0;
let allLoaded = false;

export async function initGallery(): Promise<void> {
  currentPage = 0;
  allLoaded = false;

  const grid = document.getElementById("gallery-grid");
  if (grid) grid.innerHTML = "";

  await loadPage();

  document.getElementById("gallery-search")?.addEventListener("input", (e) => {
    const q = (e.target as HTMLInputElement).value.toLowerCase();
    filterItems(q);
  });
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

function filterItems(query: string): void {
  document.querySelectorAll<HTMLElement>(".gallery-item").forEach((item) => {
    const prompt = item.dataset["prompt"] ?? "";
    item.style.display = prompt.includes(query) ? "" : "none";
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
