import { FormEvent, useState } from "react";

import { api } from "../api";
import { useApi } from "../hooks/useApi";

type AdminUser = {
  id: number;
  username: string;
  full_name: string;
  role: string;
  coach_id: number | null;
  coach_name: string | null;
};

type Trainer = {
  id: number;
  full_name: string;
};

type StravaEvent = {
  id: string;
  timestamp: string;
  source: "webhook" | "cron" | "system";
  level: "info" | "warn" | "error";
  message: string;
  details?: Record<string, unknown>;
};

function formatEventTime(value: string) {
  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function formatLogLine(entry: StravaEvent) {
  const prefix = `[${formatEventTime(entry.timestamp)}] [${entry.source.toUpperCase()}] [${entry.level.toUpperCase()}]`;
  const details = entry.details && Object.keys(entry.details).length > 0
    ? ` ${JSON.stringify(entry.details)}`
    : "";
  return `${prefix} ${entry.message}${details}`;
}

export function AdminPage() {
  const usersApi = useApi<{ users: AdminUser[] }>("/api/admin/users");
  const trainersApi = useApi<{ trainers: Trainer[] }>("/api/admin/trainers");
  const eventsApi = useApi<{ events: StravaEvent[] }>("/api/admin/strava/events?limit=80");

  const [form, setForm] = useState({
    fullName: "",
    username: "",
    password: "",
    role: "trainer",
    coachId: ""
  });

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    try {
      await api("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          fullName: form.fullName,
          username: form.username,
          password: form.password,
          role: form.role,
          coachId: form.role === "athlete" && form.coachId ? Number(form.coachId) : null
        })
      });
      setForm({ fullName: "", username: "", password: "", role: "trainer", coachId: "" });
      usersApi.refresh();
      if (form.role === "trainer") {
        trainersApi.refresh();
      }
    } catch (err: any) {
      alert(`Ошибка: ${err.message}`);
    }
  }

  async function deleteUser(id: number, username: string) {
    if (!window.confirm(`Вы уверены, что хотите удалить пользователя @${username}? Это необратимо.`)) {
      return;
    }
    try {
      await api(`/api/admin/users/${id}`, { method: "DELETE" });
      usersApi.refresh();
      trainersApi.refresh();
    } catch (err: any) {
      alert(`Ошибка удаления: ${err.message}`);
    }
  }

  const users = usersApi.data?.users ?? [];
  const trainers = trainersApi.data?.trainers ?? [];
  const events = eventsApi.data?.events ?? [];
  const logText = events.map(formatLogLine).join("\n");

  return (
    <div className="stack">
      <section className="card">
        <div className="section-header">
          <div>
            <h2>Strava Логи</h2>
            <p className="muted">
              Последние серверные события webhook и cron. Используй обновление, чтобы увидеть новые срабатывания.
            </p>
          </div>
          <button type="button" className="ghost-button" onClick={eventsApi.refresh}>
            Обновить
          </button>
        </div>

        <div className="admin-log-card">
          {eventsApi.loading ? <div className="muted">Загрузка логов...</div> : null}
          {eventsApi.error ? <div className="error-box">{eventsApi.error}</div> : null}
          {!eventsApi.loading && !eventsApi.error && events.length === 0 ? (
            <div className="muted">Пока нет событий. Логи начнут появляться после webhook или cron-тиков.</div>
          ) : null}
          {!eventsApi.loading && !eventsApi.error && events.length > 0 ? (
            <textarea className="admin-log-output" value={logText} readOnly spellCheck={false} />
          ) : null}
        </div>
      </section>

      <div className="grid two-columns">
        <section className="card">
          <h2>Создать учетку</h2>
          <form className="form" onSubmit={onSubmit}>
            <label>
              Имя
              <input
                required
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              />
            </label>
            <label>
              Логин
              <input
                required
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
            </label>
            <label>
              Пароль
              <input
                required
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </label>
            <label>
              Роль
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value, coachId: "" })}
              >
                <option value="trainer">Тренер</option>
                <option value="athlete">Спортсмен</option>
              </select>
            </label>
            {form.role === "athlete" ? (
              <label>
                Тренер
                <select
                  value={form.coachId}
                  onChange={(e) => setForm({ ...form, coachId: e.target.value })}
                >
                  <option value="">Выбери тренера</option>
                  {trainers.map((trainer) => (
                    <option key={trainer.id} value={trainer.id}>
                      {trainer.full_name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <button className="primary-button">Создать</button>
          </form>
        </section>

        <section className={usersApi.loading ? "card skeleton-card" : "card"}>
          <h2>Пользователи {usersApi.loading ? "(Загрузка...)" : ""}</h2>
          {usersApi.error && <p className="muted" style={{ color: "red" }}>{usersApi.error}</p>}
          <div className="list">
            {users.map((user) => (
              <div key={user.id} className="list-row">
                <div>
                  <strong>{user.full_name}</strong>
                  <div className="muted">@{user.username}</div>
                </div>
                <div className="align-right">
                  <div
                    style={{
                      display: "flex",
                      gap: "8px",
                      alignItems: "center",
                      justifyContent: "flex-end",
                      marginBottom: "4px"
                    }}
                  >
                    {user.role !== "admin" && (
                      <button
                        type="button"
                        className="ghost-button"
                        style={{
                          padding: "4px 8px",
                          fontSize: "12px",
                          minHeight: "auto",
                          color: "red"
                        }}
                        onClick={() => deleteUser(user.id, user.username)}
                      >
                        Удалить
                      </button>
                    )}
                  </div>
                  {user.coach_name ? <div className="muted">Тренер: {user.coach_name}</div> : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
