import { FormEvent, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { pathForRole } from "../components/RequireAuth";
import type { AppRole } from "../types";

import { useAuth } from "../components/AuthProvider";
import { isTelegramMiniApp } from "../telegram";
import logoImage from "../assets/logo-red-horizontal.webp";

export function LoginPage() {
  const { user, loading, login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from;
  const goHome = (role: AppRole) => navigate(from ? pathForRole(from, role) : `/${role}`, { replace: true });

  useEffect(() => {
    if (user) goHome(user.role);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");

    try {
      const nextUser = await login(username, password);
      goHome(nextUser.role);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Ошибка входа");
    } finally {
      setPending(false);
    }
  }

  // Пока выясняем, кто вошёл (в Telegram — автоматически по подписи), формы нет:
  // иначе она мелькает на долю секунды перед кабинетом
  if (loading || user) {
    return <SplashScreen />;
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-logo-wrap">
          <img className="login-logo" src={logoImage} alt="Running Rehab" />
        </div>
        <h1>Вход в кабинет</h1>
        <p className="ds-sub" style={{ margin: "0 0 20px" }}>
          {isTelegramMiniApp
            ? "Войдите один раз логином и паролем — дальше вход из Telegram будет автоматическим."
            : "Логин и пароль выдаёт администратор клуба."}
        </p>
        <form onSubmit={onSubmit} className="form">
          <label>
            Логин
            <input value={username} autoComplete="username" onChange={(e) => setUsername(e.target.value)} />
          </label>
          <label>
            Пароль
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error ? <div className="error-box">{error}</div> : null}
          <button className="ds-btn ds-btn-1 ds-btn-full" disabled={pending}>
            {pending ? "Входим..." : "Войти"}
          </button>
        </form>
      </div>
    </div>
  );
}

// Заставка на время входа: логотип и бегущая полоска
export function SplashScreen() {
  return (
    <div className="splash" role="status" aria-label="Загрузка">
      <div className="splash-logo">
        <img src={logoImage} alt="Running Rehab" />
      </div>
      <div className="splash-track" aria-hidden="true">
        <i />
      </div>
    </div>
  );
}
