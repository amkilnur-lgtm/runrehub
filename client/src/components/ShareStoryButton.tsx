import { useState } from "react";

import { api } from "../api";
import { getTelegramWebApp, isTelegramMiniApp } from "../telegram";
import { useToast } from "./ToastProvider";

type ShareStoryButtonProps = {
  workoutId: number;
  role: "athlete" | "trainer";
  title: string;
  className?: string;
  // иконка в шапке экрана тренировки (не основная кнопка)
  iconOnly?: boolean;
};

const ShareIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path d="M12 3v12M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Картинка 1080×1920 для сторис. В Telegram — родное «в историю»; на телефоне —
// системное «Поделиться» с файлом; иначе — скачивание PNG
export function ShareStoryButton({ workoutId, role, title, className, iconOnly }: ShareStoryButtonProps) {
  const showToast = useToast();
  const [busy, setBusy] = useState(false);

  async function share() {
    setBusy(true);
    try {
      const telegram = getTelegramWebApp();
      if (isTelegramMiniApp && telegram?.shareToStory && telegram.isVersionAtLeast?.("7.8")) {
        const { url } = await api<{ url: string }>(`/api/${role}/workouts/${workoutId}/story-link`);
        telegram.shareToStory(url);
        return;
      }

      const response = await fetch(`/api/${role}/workouts/${workoutId}/story.png`, { credentials: "include" });
      if (!response.ok) throw new Error("Не удалось подготовить картинку");
      const blob = await response.blob();
      const file = new File([blob], `runrehab-${workoutId}.png`, { type: "image/png" });

      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title });
        } catch (error) {
          // пользователь закрыл окно «Поделиться» — это не ошибка
          if ((error as DOMException).name !== "AbortError") throw error;
        }
        return;
      }

      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
      showToast("success", "Картинка для сторис сохранена");
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Не удалось поделиться");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className={className ?? "share-button"}
      onClick={() => void share()}
      disabled={busy}
      aria-label={iconOnly ? (busy ? "Готовим картинку" : "Поделиться в сторис") : undefined}
      title={iconOnly ? "Поделиться в сторис" : undefined}
    >
      {ShareIcon}
      {iconOnly ? null : busy ? "Готовим картинку…" : "Поделиться"}
    </button>
  );
}
