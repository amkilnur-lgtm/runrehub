// Mini App: Telegram открывает сайт с подписанными данными пользователя в адресе
// (#tgWebAppData=...). Забираем их при старте, пока роутер не трогал адрес, и
// держим в sessionStorage, чтобы вход пережил перезагрузку страницы внутри Telegram.
const STORAGE_KEY = "rr-telegram-init-data";
const TELEGRAM_SCRIPT_URL = "https://telegram.org/js/telegram-web-app.js";

type TelegramWebApp = {
  ready: () => void;
  expand: () => void;
  isVersionAtLeast?: (version: string) => boolean;
  shareToStory?: (mediaUrl: string, params?: { text?: string }) => void;
  BackButton?: { show: () => void; hide: () => void; onClick: (cb: () => void) => void; offClick: (cb: () => void) => void };
  HapticFeedback?: { impactOccurred: (style: "light" | "medium") => void };
};

export function getTelegramWebApp(): TelegramWebApp | null {
  return (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp ?? null;
}

function readInitData(): string | null {
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
  const fromHash = hash ? new URLSearchParams(hash).get("tgWebAppData") : null;
  if (fromHash) {
    try {
      sessionStorage.setItem(STORAGE_KEY, fromHash);
    } catch {
      // приватный режим — обойдёмся без сохранения
    }
    return fromHash;
  }
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export const telegramInitData = readInitData();
export const isTelegramMiniApp = Boolean(telegramInitData);

// Скрипт Telegram нужен только внутри Mini App (раскрыть на весь экран, убрать заставку),
// поэтому в обычном браузере его не грузим вовсе
if (isTelegramMiniApp) {
  const script = document.createElement("script");
  script.src = TELEGRAM_SCRIPT_URL;
  script.async = true;
  script.onload = () => {
    const webApp = getTelegramWebApp();
    webApp?.ready();
    webApp?.expand();
  };
  document.head.appendChild(script);
}
