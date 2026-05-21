import { PhotoUploader } from "../components/uploader.js";
import { notifications } from "../components/notifications.js";
import { uploadPhoto, startGeneration, getGenerationStatus, sleep, getToken } from "../api.js";

export interface GenerationResult {
  generationId: number;
  resultUrl: string;
  prompt: string;
  originalDataUrl: string;
  elapsedSeconds: number;
}

type Navigate = (page: string, data?: GenerationResult) => void;

const uploader = new PhotoUploader();
let hasPhoto = false;
let generateInitialized = false;
let currentOnNeedAuth: ((onSuccess: () => void) => void) | undefined;

export function initGenerate(navigate: Navigate, onNeedAuth?: (onSuccess: () => void) => void): void {
  currentOnNeedAuth = onNeedAuth;

  if (generateInitialized) return;
  generateInitialized = true;

  uploader.init((photo) => {
    hasPhoto = photo !== null;
    updateGenerateBtn();
  });

  const promptInput = document.getElementById("prompt-input") as HTMLTextAreaElement | null;
  const charCount = document.getElementById("char-count");
  const MAX_CHARS = 500;

  promptInput?.addEventListener("input", () => {
    if (promptInput.value.length > MAX_CHARS) {
      promptInput.value = promptInput.value.slice(0, MAX_CHARS);
    }
    if (charCount) charCount.textContent = String(promptInput.value.length);
    updateGenerateBtn();
  });

  document.querySelectorAll<HTMLButtonElement>(".suggestion-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const suggestion = btn.dataset["suggestion"] ?? "";
      if (promptInput) {
        promptInput.value = suggestion;
        if (charCount) charCount.textContent = String(suggestion.length);
        updateGenerateBtn();
      }
    });
  });

  document.getElementById("generate-btn")?.addEventListener("click", () => {
    void handleGenerate(navigate);
  });
}

function updateGenerateBtn(): void {
  const btn = document.getElementById("generate-btn") as HTMLButtonElement | null;
  if (!btn) return;
  const prompt = (document.getElementById("prompt-input") as HTMLTextAreaElement | null)?.value.trim() ?? "";
  btn.disabled = !hasPhoto || prompt.length === 0;
}

async function handleGenerate(navigate: Navigate): Promise<void> {
  const photo = uploader.getPhoto();
  const promptEl = document.getElementById("prompt-input") as HTMLTextAreaElement | null;
  const prompt = promptEl?.value.trim() ?? "";

  if (!photo) { notifications.error("Пожалуйста, загрузите фото"); return; }
  if (!prompt) { notifications.error("Пожалуйста, введите описание"); return; }

  if (!getToken()) {
    if (currentOnNeedAuth) currentOnNeedAuth(() => void handleGenerate(navigate));
    return;
  }

  setLoading(true);
  showStatus("⏳ Загружаем фото…");
  const startedAt = Date.now();

  try {
    const uploadUrl = await uploadPhoto(photo.file);
    showStatus("⏳ Запускаем генерацию…");

    const { generation_id } = await startGeneration(uploadUrl, prompt);
    showStatus("⏳ Генерируем изображение… (это занимает до 3 минут)");

    const resultUrl = await pollGeneration(generation_id);
    const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);

    hideStatus();
    notifications.success("Изображение готово!");
    navigate("results", { generationId: generation_id, resultUrl, prompt, originalDataUrl: photo.dataUrl, elapsedSeconds });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Неизвестная ошибка";
    notifications.error(`Ошибка: ${msg}`);
    hideStatus();
  } finally {
    setLoading(false);
  }
}

async function pollGeneration(id: number): Promise<string> {
  for (let i = 0; i < 60; i++) {
    await sleep(3000);
    const { status, result_url } = await getGenerationStatus(id);
    if (status === "completed" && result_url) return result_url;
    if (status === "failed") throw new Error("Генерация завершилась с ошибкой");
  }
  throw new Error("Превышено время ожидания (3 минуты)");
}

function setLoading(on: boolean): void {
  const btn = document.getElementById("generate-btn") as HTMLButtonElement | null;
  const spinner = document.getElementById("btn-spinner");
  if (btn) btn.disabled = on;
  if (spinner) spinner.style.display = on ? "inline-block" : "none";
}

function showStatus(text: string): void {
  const el = document.getElementById("status-message");
  if (el) { el.textContent = text; el.style.display = "block"; }
}

function hideStatus(): void {
  const el = document.getElementById("status-message");
  if (el) el.style.display = "none";
}
