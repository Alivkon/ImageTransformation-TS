import { getBalance, createYookassaPayment, createRobokassaPayment } from "../api.js";
import { notifications } from "../components/notifications.js";
import type { User } from "../types.js";

declare global {
  interface Window {
    YooMoneyCheckoutWidget: new (opts: {
      confirmation_token: string;
      return_url: string;
      error_callback: (err: unknown) => void;
    }) => { render: (containerId: string) => void; destroy: () => void };
  }
}

let selectedAmount: number | null = null;
let selectedMethod: "yookassa" | "robokassa" | null = null;
let activeWidget: { destroy: () => void } | null = null;

export async function updateWalletBalance(user: User): Promise<void> {
  try {
    const { balance } = await getBalance();
    const walletBalance = document.getElementById("wallet-balance");
    if (walletBalance) walletBalance.textContent = `${balance.toFixed(0)}₽`;
  } catch {
    // non-critical
  }
}

export async function initWallet(user: User): Promise<void> {
  selectedAmount = null;
  selectedMethod = null;
  if (activeWidget) { activeWidget.destroy(); activeWidget = null; }

  const walletBalance = document.getElementById("wallet-balance");
  if (walletBalance) walletBalance.textContent = `${user.balance.toFixed(0)}₽`;

  // Remove all previous topup button listeners
  document.querySelectorAll<HTMLButtonElement>(".topup-btn").forEach((btn) => {
    const newBtn = btn.cloneNode(true) as HTMLButtonElement;
    btn.parentNode?.replaceChild(newBtn, btn);
  });

  // Register new listeners
  document.querySelectorAll<HTMLButtonElement>(".topup-btn").forEach((btn) => {
    btn.classList.remove("active");
    btn.addEventListener("click", () => {
      document.querySelectorAll(".topup-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectedAmount = parseInt(btn.dataset["amount"] ?? "0", 10);
      
      // Fill custom amount field
      const customInput = document.getElementById("custom-amount") as HTMLInputElement | null;
      if (customInput) {
        customInput.value = String(selectedAmount);
      }
    });
  });

  const customAmountInput = document.getElementById("custom-amount") as HTMLInputElement | null;
  customAmountInput?.addEventListener("input", () => {
    const val = parseInt(customAmountInput.value, 10);
    selectedAmount = isNaN(val) ? null : val;
    document.querySelectorAll(".topup-btn").forEach((b) => b.classList.remove("active"));
  });

  document.querySelectorAll<HTMLButtonElement>(".method-btn").forEach((btn) => {
    btn.classList.remove("active");
    btn.addEventListener("click", () => {
      document.querySelectorAll(".method-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectedMethod = btn.dataset["method"] as "yookassa" | "robokassa";
    });
  });

  document.getElementById("pay-btn")?.addEventListener("click", () => {
    void handlePay();
  });

  try {
    const { balance } = await getBalance();
    if (walletBalance) walletBalance.textContent = `${balance.toFixed(0)}₽`;
  } catch {
    // non-critical
  }
}

async function handlePay(): Promise<void> {
  if (!selectedAmount || selectedAmount < 100) {
    notifications.error("Пожалуйста, выберите сумму (минимум 100₽)");
    return;
  }
  if (!selectedMethod) {
    notifications.error("Пожалуйста, выберите способ оплаты");
    return;
  }

  const btn = document.getElementById("pay-btn") as HTMLButtonElement | null;
  if (btn) btn.disabled = true;

  try {
    if (selectedMethod === "yookassa") {
      await handleYookassa(selectedAmount);
    } else {
      await handleRobokassa(selectedAmount);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Ошибка";
    notifications.error(`Ошибка оплаты: ${msg}`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function handleYookassa(amount: number): Promise<void> {
  const { confirmation_token } = await createYookassaPayment(amount);

  if (!confirmation_token) {
    notifications.error("Не удалось создать платёж YooKassa");
    return;
  }

  await loadYookassaScript();

  let container = document.getElementById("yookassa-widget-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "yookassa-widget-container";
    document.getElementById("pay-btn")?.insertAdjacentElement("afterend", container);
  }
  container.innerHTML = "";

  const returnUrl = new URL(window.location.origin);
  returnUrl.searchParams.set("payment_success", "true");

  const widget = new window.YooMoneyCheckoutWidget({
    confirmation_token,
    return_url: returnUrl.toString(),
    error_callback: (err) => notifications.error(`YooKassa ошибка: ${String(err)}`),
  });
  activeWidget = widget;
  widget.render("yookassa-widget-container");
}

async function handleRobokassa(amount: number): Promise<void> {
  const { payment_url } = await createRobokassaPayment(amount);
  window.location.href = payment_url;
}

function loadYookassaScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.YooMoneyCheckoutWidget) { resolve(); return; }
    const script = document.createElement("script");
    script.src = "https://yookassa.ru/checkout-widget/v1/checkout-widget.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Не удалось загрузить виджет YooKassa"));
    document.head.appendChild(script);
  });
}
