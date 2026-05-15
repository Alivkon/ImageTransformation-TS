type ToastType = "success" | "error" | "warning" | "info";

const ICONS: Record<ToastType, string> = {
  success: "✓",
  error: "✕",
  warning: "⚠",
  info: "ℹ",
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return map[c] ?? c;
  });
}

function show(message: string, type: ToastType, duration = 3000): void {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <div class="toast-icon">${ICONS[type]}</div>
    <div class="toast-content">
      <div class="toast-message">${escapeHtml(message)}</div>
    </div>
    <button class="toast-close">×</button>
  `;

  container.appendChild(toast);

  const remove = (): void => {
    toast.classList.add("remove");
    setTimeout(() => toast.remove(), 300);
  };

  toast.querySelector(".toast-close")?.addEventListener("click", remove);

  if (duration > 0) setTimeout(remove, duration);
}

export const notifications = {
  success: (msg: string) => show(msg, "success"),
  error: (msg: string) => show(msg, "error"),
  warning: (msg: string) => show(msg, "warning"),
  info: (msg: string) => show(msg, "info"),
};
