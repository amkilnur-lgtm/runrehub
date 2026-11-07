import { NavLink, Outlet, useNavigate } from "react-router-dom";

import logoImage from "../assets/logo_red horizontal.png";
import { useAuth } from "./AuthProvider";
import { EditableAvatarMenu } from "./EditableAvatarMenu";
import { ThemeToggle } from "./ThemeToggle";

type NavItem = { to: string; label: string; end?: boolean; icon: React.ReactNode };

const HomeIcon = (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
    <path d="M3 11.5 12 4l9 7.5M5.5 9.5V20h13V9.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const FeedIcon = (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
    <path d="M4 6h16M4 12h16M4 18h10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const NAV_BY_ROLE: Record<string, NavItem[]> = {
  trainer: [
    { to: "/trainer", label: "Обзор", end: true, icon: HomeIcon },
    { to: "/trainer/feed", label: "Лента", icon: FeedIcon }
  ]
};

export function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const nav = user ? NAV_BY_ROLE[user.role] ?? [] : [];

  async function handleLogout() {
    await logout();
    navigate("/");
  }

  return (
    <div className={nav.length ? "app has-tabbar" : "app"}>
      <header className="app-topbar">
        <div className="app-topbar-inner">
          <NavLink to={user ? `/${user.role}` : "/"} className="app-logo" aria-label="Running Rehab — на главную">
            <img src={logoImage} alt="" />
          </NavLink>
          {nav.length ? (
            <nav className="app-nav" aria-label="Разделы">
              {nav.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} className="app-nav-link">
                  <span className="app-nav-icon">{item.icon}</span>
                  {item.label}
                </NavLink>
              ))}
            </nav>
          ) : null}
          <div className="app-topbar-actions">
            <ThemeToggle />
            <button type="button" className="icon-button" onClick={handleLogout} aria-label="Выйти" title="Выйти">
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path d="M10 4H5v16h5M13 8l4 4-4 4M9 12h8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {user ? (
              <EditableAvatarMenu fullName={user.fullName} avatarUrl={user.avatarUrl} className="app-topbar-avatar" />
            ) : null}
          </div>
        </div>
      </header>
      <main className="app-content">
        <Outlet />
      </main>
    </div>
  );
}
