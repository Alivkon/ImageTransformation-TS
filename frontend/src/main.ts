import { initTheme } from "./components/theme.js";
import { notifications } from "./components/notifications.js";
import { initDashboard } from "./pages/dashboard.js";
import { initGenerate } from "./pages/generate.js";
import type { GenerationResult } from "./pages/generate.js";
import { initResults } from "./pages/results.js";
import { initGallery } from "./pages/gallery.js";
import { initWallet } from "./pages/wallet.js";
import { getMe, login, register, logout, setToken, resendVerification } from "./api.js";
import type { User } from "./types.js";

// ── State ──────────────────────────────────────────────────────────────────

let currentUser: User | null = null;
let currentPage = "dashboard";
let lastGenerationResult: GenerationResult | null = null;

// ── Navigation ─────────────────────────────────────────────────────────────

const PAGES = ["dashboard", "generate", "gallery", "wallet", "results"] as const;
type Page = (typeof PAGES)[number];

function navigate(page: string, data?: GenerationResult): void {
  if (data) lastGenerationResult = data;

  // Hide all pages
  PAGES.forEach((p) => {
    const el = document.getElementById(`page-${p}`);
    if (el) el.classList.remove("active");
  });

  // Show target page
  const target = document.getElementById(`page-${page}`);
  if (target) target.classList.add("active");
  else { navigate("dashboard"); return; }

  // Update nav items
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.remove("active");
    if ((item as HTMLElement).dataset["page"] === page) item.classList.add("active");
  });

  currentPage = page;
  window.scrollTo(0, 0);

  if (!currentUser) return;

  const user = currentUser;
  if (page === "dashboard") void initDashboard(user, navigate);
  if (page === "generate") initGenerate(navigate);
  if (page === "results") initResults(lastGenerationResult, navigate);
  if (page === "gallery") void initGallery();
  if (page === "wallet") void initWallet(user);
}

// ── Auth overlay ───────────────────────────────────────────────────────────

function showAuthOverlay(): void {
  const overlay = document.getElementById("auth-overlay");
  const app = document.getElementById("app");
  const header = document.getElementById("header");
  if (overlay) overlay.style.display = "flex";
  if (app) app.style.display = "none";
  if (header) header.style.display = "none";
}

function hideAuthOverlay(): void {
  const overlay = document.getElementById("auth-overlay");
  const app = document.getElementById("app");
  const header = document.getElementById("header");
  if (overlay) overlay.style.display = "none";
  if (app) app.style.display = "";
  if (header) header.style.display = "";
}

function showAuthInfo(msg: string, showResend = false): void {
  const infoEl = document.getElementById("auth-info");
  if (infoEl) { infoEl.textContent = msg; infoEl.style.display = "block"; }
  const resendBtn = document.getElementById("auth-resend") as HTMLButtonElement | null;
  if (resendBtn) resendBtn.style.display = showResend ? "block" : "none";
}

function hideAuthInfo(): void {
  const infoEl = document.getElementById("auth-info");
  if (infoEl) infoEl.style.display = "none";
  const resendBtn = document.getElementById("auth-resend") as HTMLButtonElement | null;
  if (resendBtn) resendBtn.style.display = "none";
}

function setupAuthForm(): void {
  const overlay = document.getElementById("auth-overlay");
  if (!overlay) return;

  const tabLogin = document.getElementById("tab-login");
  const tabRegister = document.getElementById("tab-register");
  const submitBtn = document.getElementById("auth-submit") as HTMLButtonElement | null;
  const errorEl = document.getElementById("auth-error");
  let isRegister = false;
  let lastEmail = "";

  tabLogin?.addEventListener("click", () => {
    isRegister = false;
    tabLogin.classList.add("active");
    tabRegister?.classList.remove("active");
    if (submitBtn) submitBtn.textContent = "Войти";
    if (errorEl) errorEl.style.display = "none";
    hideAuthInfo();
  });

  tabRegister?.addEventListener("click", () => {
    isRegister = true;
    tabRegister.classList.add("active");
    tabLogin?.classList.remove("active");
    if (submitBtn) submitBtn.textContent = "Зарегистрироваться";
    if (errorEl) errorEl.style.display = "none";
    hideAuthInfo();
  });

  document.getElementById("auth-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const email = (document.getElementById("auth-email") as HTMLInputElement).value.trim();
    lastEmail = email;
    const password = (document.getElementById("auth-password") as HTMLInputElement).value;
    void handleAuthSubmit(email, password, isRegister, errorEl, submitBtn);
  });

  document.getElementById("auth-resend")?.addEventListener("click", () => {
    if (!lastEmail) return;
    void resendVerification(lastEmail).then((r) => showAuthInfo(r.message)).catch(() => undefined);
  });
}

async function handleAuthSubmit(
  email: string,
  password: string,
  isRegister: boolean,
  errorEl: HTMLElement | null,
  submitBtn: HTMLButtonElement | null,
): Promise<void> {
  if (submitBtn) submitBtn.disabled = true;
  if (errorEl) errorEl.style.display = "none";
  hideAuthInfo();

  try {
    if (isRegister) {
      const resp = await register(email, password);
      showAuthInfo(resp.message, true);
    } else {
      const resp = await login(email, password);
      currentUser = resp.user;
      hideAuthOverlay();
      setupApp();
      navigate("dashboard");
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Ошибка авторизации";
    if (errorEl) { errorEl.textContent = msg; errorEl.style.display = "block"; }
    // Если email не подтверждён — показываем кнопку повторной отправки
    if (msg.includes("не подтверждён")) showAuthInfo("", true);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

// ── Profile menu ───────────────────────────────────────────────────────────

function setupProfileMenu(): void {
  document.getElementById("profile-menu")?.addEventListener("click", () => {
    const confirmed = window.confirm("Выйти из аккаунта?");
    if (!confirmed) return;
    void logout().then(() => {
      currentUser = null;
      showAuthOverlay();
    });
  });
}

// ── Nav ────────────────────────────────────────────────────────────────────

function setupNav(): void {
  document.querySelectorAll<HTMLButtonElement>(".nav-item").forEach((item) => {
    const page = item.dataset["page"];
    if (page) item.addEventListener("click", () => navigate(page));
  });
}

// ── App init ───────────────────────────────────────────────────────────────

function setupApp(): void {
  setupNav();
  setupProfileMenu();
}

async function main(): Promise<void> {
  initTheme();
  setupAuthForm();

  // После перехода по ссылке верификации сервер редиректит на /?session=TOKEN
  const params = new URLSearchParams(window.location.search);
  const sessionToken = params.get("session");
  if (sessionToken) {
    setToken(sessionToken);
    window.history.replaceState({}, "", "/");
  }

  try {
    currentUser = await getMe();
    hideAuthOverlay();
    setupApp();
    navigate("dashboard");
  } catch {
    showAuthOverlay();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  void main();
});

// Suppress TS unused warning
void notifications;
