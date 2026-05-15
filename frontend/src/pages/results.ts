import type { GenerationResult } from "./generate.js";
import { notifications } from "../components/notifications.js";

type Navigate = (page: string) => void;

export function initResults(result: GenerationResult | null, navigate: Navigate): void {
  const originalImg = document.getElementById("result-original") as HTMLImageElement | null;
  const generatedImg = document.getElementById("result-generated") as HTMLImageElement | null;
  const promptEl = document.getElementById("result-prompt");

  if (result) {
    if (originalImg) originalImg.src = result.originalDataUrl;
    if (generatedImg) generatedImg.src = result.resultUrl;
    if (promptEl) promptEl.textContent = result.prompt;
  }

  document.getElementById("download-btn")?.addEventListener("click", () => {
    if (!generatedImg?.src) return;
    const link = document.createElement("a");
    link.href = generatedImg.src;
    link.download = "transformation_result.jpg";
    link.click();
  });

  document.getElementById("share-btn")?.addEventListener("click", () => {
    if (!generatedImg?.src) return;
    if (navigator.share) {
      navigator
        .share({ title: "ImageTransformation Result", url: generatedImg.src })
        .catch(() => notifications.info("Поделиться не удалось"));
    } else {
      notifications.info("Функция поделиться недоступна");
    }
  });

  document.getElementById("generate-another-btn")?.addEventListener("click", () => navigate("generate"));
  document.getElementById("back-dashboard-btn")?.addEventListener("click", () => navigate("dashboard"));
}
