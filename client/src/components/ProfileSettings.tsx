import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "./AuthProvider";

// «Настройки» внизу профиля: тема (Светлая · Тёмная · Авто) и выход. Раньше — иконками в шапке.
type ThemeChoice = "light" | "dark" | "auto";
const STORAGE_KEY = "rr-theme";

function readChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "auto";
  } catch {
    return "auto";
  }
}

function applyChoice(choice: ThemeChoice) {
  try {
    if (choice === "auto") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // приватный режим — тема просто не запомнится
  }
  if (choice === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = choice;
}

export function ProfileSettings() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [theme, setTheme] = useState<ThemeChoice>(readChoice);
  return (
    <div>
      <div className="ds-grp">
        <span>Настройки</span>
      </div>
      <div className="ds-list">
        <div className="ds-li me-row">
          <div className="ds-m">
            <b>Тема</b>
          </div>
          <div className="ds-seg me-theme" role="group" aria-label="Тема">
            {(
              [
                ["light", "Светлая"],
                ["dark", "Тёмная"],
                ["auto", "Авто"]
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={theme === value}
                onClick={() => {
                  setTheme(value);
                  applyChoice(value);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          className="ds-li me-row me-logout"
          onClick={async () => {
            if (!window.confirm("Выйти из RunRehab?")) return;
            await logout();
            navigate("/");
          }}
        >
          Выйти
        </button>
      </div>
    </div>
  );
}
