import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../components/AuthProvider";
import logoImage from "../assets/logo_red horizontal.png";

export function LoginPage() {
  const { user, login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (user?.role === "admin") navigate("/admin");
    if (user?.role === "trainer") navigate("/trainer");
    if (user?.role === "athlete") navigate("/athlete");
  }, [navigate, user]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");

    try {
      const nextUser = await login(username, password);
      if (nextUser.role === "admin") navigate("/admin");
      if (nextUser.role === "trainer") navigate("/trainer");
      if (nextUser.role === "athlete") navigate("/athlete");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Ошибка входа");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <img className="login-logo" src={logoImage} alt="Running Rehab" />
        <h1>Вход в кабинет</h1>
        <p className="muted">
          Админ выдает логин и пароль. После входа спортсмен может привязать свою Strava.
        </p>
        <form onSubmit={onSubmit} className="form">
          <label>
            Логин
            <input value={username} onChange={(e) => setUsername(e.target.value)} />
          </label>
          <label>
            Пароль
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error ? <div className="error-box">{error}</div> : null}
          <button className="primary-button" disabled={pending}>
            {pending ? "Входим..." : "Войти"}
          </button>
        </form>
      </div>
    </div>
  );
}
