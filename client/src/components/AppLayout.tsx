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
          <div className="eyebrow">RunRehab</div>
          <div className="topbar-title-row">
            <h1>{user?.fullName}</h1>
            <span className="role-badge">{user?.role}</span>
          </div>
        </div>
        <div className="topbar-actions">
          <button className="ghost-button" onClick={handleLogout}>
            Выйти
          </button>
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
