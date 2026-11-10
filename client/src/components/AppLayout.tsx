import { useEffect, useState } from "react";
import { NavLink, Outlet, ScrollRestoration, useLocation, useNavigate } from "react-router-dom";

import { api } from "../api";

import logoImage from "../assets/logo_red horizontal.png";
import { useAuth } from "./AuthProvider";
import { EditableAvatarMenu } from "./EditableAvatarMenu";
import { NavGestures } from "./NavGestures";
import { ThemeToggle } from "./ThemeToggle";

type NavItem = { to: string; label: string; end?: boolean; icon: React.ReactNode; badgeKey?: "review" };

function Icon({ d }: { d: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d}
    </svg>
  );
}

const HomeIcon = <Icon d={<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z" />} />;
const RunsIcon = <Icon d={<path d="M4 6h16M4 12h16M4 18h10" />} />;
const StartsIcon = <Icon d={<path d="M5 21V4M5 4h11l-2 4 2 4H5" />} />;
const ClubIcon = (
  <Icon
    d={
      <>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2.5 20c.8-3.6 3.3-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c1.7.7 2.7 2.4 3 5.2" />
      </>
    }
  />
);
const ReviewIcon = <Icon d={<path d="M4 5h16v11H9l-5 4V5z" />} />;

// 4 вкладки на роль, подпись одним словом (client/DESIGN.md → «Информационная архитектура»)
const NAV_BY_ROLE: Record<string, NavItem[]> = {
  athlete: [
    { to: "/athlete", label: "Главная", end: true, icon: HomeIcon },
    { to: "/athlete/runs", label: "Пробежки", icon: RunsIcon },
    { to: "/athlete/starts", label: "Старты", icon: StartsIcon },
    { to: "/athlete/feed", label: "Клуб", icon: ClubIcon }
  ],
  trainer: [
    { to: "/trainer", label: "Группа", end: true, icon: ClubIcon },
    { to: "/trainer/review", label: "Разбор", icon: ReviewIcon, badgeKey: "review" },
    { to: "/trainer/starts", label: "Старты", icon: StartsIcon },
    { to: "/trainer/feed", label: "Клуб", icon: RunsIcon }
  ]
};

export function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const nav = user ? NAV_BY_ROLE[user.role] ?? [] : [];
  const location = useLocation();
  // счётчик только у «Разбора»: пробежки этой недели без комментария
  const [reviewCount, setReviewCount] = useState(0);
  useEffect(() => {
    if (user?.role !== "trainer") return;
    api<{ workoutIds: number[] }>("/api/trainer/review-queue")
      .then((res) => setReviewCount(res.workoutIds.length))
      .catch(() => undefined);
  }, [user?.role, location.pathname]);

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
                  {item.badgeKey === "review" && reviewCount > 0 ? (
                    <span className="app-nav-badge" aria-label={`ждут: ${reviewCount}`}>
                      {reviewCount}
                    </span>
                  ) : null}
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
      {/* «назад» возвращает на то же место страницы, новая страница — сверху */}
      <ScrollRestoration />
      <NavGestures home={user ? `/${user.role}` : "/"} />
    </div>
  );
}
