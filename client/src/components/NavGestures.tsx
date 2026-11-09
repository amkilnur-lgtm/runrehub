import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { getTelegramWebApp, isTelegramMiniApp } from "../telegram";

const EDGE_PX = 28; // жест начинается у левого края экрана
const TRIGGER_PX = 72; // столько надо протянуть вправо, чтобы уйти назад

function canGoBack() {
  const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
  return idx > 0;
}

// Внутри Telegram нет системного «назад» жестом и своей кнопки на наших страницах:
// показываем нативную BackButton и ловим свайп вправо от левого края.
// В обычном браузере это всё уже есть — ничего не делаем.
export function NavGestures({ home }: { home: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [pull, setPull] = useState(0);
  const pullRef = useRef(0);

  useEffect(() => {
    if (!isTelegramMiniApp) return undefined;
    const backButton = getTelegramWebApp()?.BackButton;
    if (!backButton) return undefined;
    const goBack = () => navigate(-1);
    if (canGoBack() && location.pathname !== home) {
      backButton.show();
      backButton.onClick(goBack);
    } else {
      backButton.hide();
    }
    return () => backButton.offClick(goBack);
  }, [location.key, location.pathname, home, navigate]);

  useEffect(() => {
    if (!isTelegramMiniApp) return undefined;
    let startX = 0;
    let startY = 0;
    let tracking = false;
    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      tracking = Boolean(touch && touch.clientX <= EDGE_PX && canGoBack());
      if (tracking && touch) {
        startX = touch.clientX;
        startY = touch.clientY;
      }
    };
    const onMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!tracking || !touch) return;
      const dx = touch.clientX - startX;
      const dy = Math.abs(touch.clientY - startY);
      if (dy > 40 && dy > dx) {
        tracking = false;
        pullRef.current = 0;
        setPull(0);
        return;
      }
      pullRef.current = Math.max(0, dx);
      setPull(pullRef.current);
    };
    const onEnd = () => {
      if (tracking && pullRef.current >= TRIGGER_PX) {
        getTelegramWebApp()?.HapticFeedback?.impactOccurred("light");
        navigate(-1);
      }
      tracking = false;
      pullRef.current = 0;
      setPull(0);
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [navigate]);

  if (!pull) return null;
  const progress = Math.min(pull / TRIGGER_PX, 1);
  return (
    <div
      className={progress >= 1 ? "nav-back-hint is-ready" : "nav-back-hint"}
      style={{ transform: `translate(${Math.min(pull, TRIGGER_PX + 12) - 44}px, -50%)`, opacity: 0.35 + progress * 0.65 }}
      aria-hidden="true"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 6l-6 6 6 6" />
      </svg>
    </div>
  );
}
