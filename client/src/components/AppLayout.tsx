import { Outlet, useNavigate } from "react-router-dom";

import { useAuth } from "./AuthProvider";

export function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/");
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-identity">
          <div className="eyebrow">RunningRehab</div>
          <div className="topbar-actions">
            <button className="ghost-button topbar-logout" onClick={handleLogout}>
              Выйти
            </button>
          </div>
        </div>
        <div className="topbar-main-row">
          <div className="topbar-left-group">
            <div className="topbar-name-box">
              <h1>{user?.fullName}</h1>
            </div>
            <span className="role-badge">{user?.role}</span>
          </div>
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
