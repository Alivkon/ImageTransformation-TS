let initialized = false;

const PREVIEWABLE_IMAGES = [
  ".review-image-button img",
  "#recent-gallery .gallery-item img",
  "#gallery-grid .gallery-item img",
  ".results-grid .result-image",
  ".upload-preview img",
].join(", ");

export function initImagePreview(): void {
  if (initialized) return;

  const preview = document.getElementById("review-preview");
  const previewImage = document.getElementById("review-preview-image") as HTMLImageElement | null;
  const closeButton = document.getElementById("review-preview-close") as HTMLButtonElement | null;
  if (!preview || !previewImage || !closeButton) return;

  initialized = true;
  let previousFocus: HTMLElement | null = null;

  const close = (): void => {
    preview.classList.remove("active");
    preview.setAttribute("aria-hidden", "true");
    previewImage.removeAttribute("src");
    document.body.style.overflow = "";
    previousFocus?.focus();
    previousFocus = null;
  };

  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    const explicitTrigger = target?.closest<HTMLElement>("[data-review-image]");
    const clickedImage = target?.closest<HTMLImageElement>(PREVIEWABLE_IMAGES);
    const src = explicitTrigger?.dataset["reviewImage"] ?? clickedImage?.currentSrc ?? clickedImage?.src;
    if (!src || target?.closest("#review-preview")) return;

    event.preventDefault();
    previousFocus = explicitTrigger ?? clickedImage ?? null;
    previewImage.src = src;
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
