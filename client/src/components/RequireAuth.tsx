import { SplashScreen } from "../pages/LoginPage";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { AppRole } from "../types";
import { useAuth } from "./AuthProvider";

export function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <SplashScreen />;
  }

  if (!user) {
    // запоминаем, куда шли (ссылка из Telegram), — после входа вернём туда
    return <Navigate to="/" replace state={{ from: location.pathname + location.search }} />;
  }

  return <Outlet />;
}

// Страницы, которые есть и у тренера, и у спортсмена: ссылку из Telegram «для тренера»
// спортсмен открывает у себя (и наоборот), без прав чужой роли
const SHARED_PAGES = [/^\/workouts\/\d+$/, /^\/athletes\/\d+$/, /^\/feed$/, /^\/starts$/, /^\/profile$/];

export function pathForRole(path: string, role: AppRole): string {
  const [pathname, search = ""] = path.split(/(?=\?)/);
  const match = pathname.match(/^\/(trainer|athlete)(\/.*)$/);
  if (match && role !== "admin" && SHARED_PAGES.some((re) => re.test(match[2]))) {
    return `/${role}${match[2]}${search}`;
  }
  return pathname.startsWith(`/${role}`) ? path : `/${role}`;
}

// Чужой раздел — отправляем в свой (на ту же страницу, если она там есть), а не показываем 403
export function RequireRole({ roles }: { roles: AppRole[] }) {
  const { user } = useAuth();
  const location = useLocation();

  if (user && !roles.includes(user.role)) {
    return <Navigate to={pathForRole(location.pathname + location.search, user.role)} replace />;
  }

  return <Outlet />;
}
