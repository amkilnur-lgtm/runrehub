import { Outlet, useNavigate } from "react-router-dom";

import { useAuth } from "./AuthProvider";

export function AppLayout() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/");
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-identity">
          <div className="topbar-brand">RunningRehab</div>
          <div className="topbar-actions">
            <button className="ghost-button topbar-logout" onClick={handleLogout}>
              <svg viewBox="0 0 24 24" className="topbar-logout-icon" aria-hidden="true">
                <path
                  d="M10 4H5v16h5M13 8l4 4-4 4M9 12h8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Выйти
            </button>
          </div>
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
