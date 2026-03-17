import { Navigate, Outlet } from "react-router-dom";

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
