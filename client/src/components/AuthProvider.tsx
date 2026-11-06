import { createContext, useContext, useEffect, useState } from "react";

import { api, SESSION_EXPIRED_EVENT } from "../api";
import { telegramInitData } from "../telegram";
import { User } from "../types";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  setUser: React.Dispatch<React.SetStateAction<User | null>>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      const data = await api<{ user: User }>("/api/auth/me");
      setUser(data.user);
    } catch {
      setUser(await loginWithTelegram());
    } finally {
      setLoading(false);
    }
  }

  // Внутри Mini App пробуем войти по подписанным данным Telegram; если Telegram
  // ещё не привязан — покажется обычная форма, и вход паролем его привяжет
  async function loginWithTelegram(): Promise<User | null> {
    if (!telegramInitData) {
      return null;
    }
    try {
      const data = await api<{ user: User }>("/api/auth/telegram", {
        method: "POST",
        body: JSON.stringify({ initData: telegramInitData })
      });
      return data.user;
    } catch {
      return null;
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    const onSessionExpired = () => setUser(null);
    window.addEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
  }, []);

  async function login(username: string, password: string) {
    const data = await api<{ user: User }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password, telegramInitData: telegramInitData ?? undefined })
    });
    setUser(data.user);
    return data.user;
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("Auth context is missing");
  }
  return value;
}
