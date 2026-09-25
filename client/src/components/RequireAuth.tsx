import { Navigate, Outlet } from "react-router-dom";

import { AppRole } from "../types";
import { useAuth } from "./AuthProvider";

export function RequireAuth() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="center-screen">Загрузка...</div>;
  }

  if (!user) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}

// Чужой раздел (атлет открыл /admin) — отправляем в свой, а не показываем 403
export function RequireRole({ roles }: { roles: AppRole[] }) {
  const { user } = useAuth();

  if (user && !roles.includes(user.role)) {
    return <Navigate to={`/${user.role}`} replace />;
  }

  return <Outlet />;
}
