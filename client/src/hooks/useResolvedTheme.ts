import { useEffect, useState } from "react";

export type ResolvedTheme = "light" | "dark";

function resolveTheme(): ResolvedTheme {
  const manual = document.documentElement.dataset.theme;
  if (manual === "light" || manual === "dark") {
    return manual;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/* Итоговая тема с учётом ручного выбора (data-theme на <html>) и системной.
   Реагирует и на тумблер в шапке, и на смену системной темы. */
export function useResolvedTheme(): ResolvedTheme {
  const [theme, setTheme] = useState<ResolvedTheme>(resolveTheme);

  useEffect(() => {
    const update = () => setTheme(resolveTheme());

    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", update);

    return () => {
      observer.disconnect();
      media.removeEventListener("change", update);
    };
  }, []);

  return theme;
}
