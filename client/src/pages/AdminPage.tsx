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

type StravaDiagnosticResponse = {
  ok: boolean;
  log: string[];
};

export function AdminPage() {
  const usersApi = useApi<{ users: AdminUser[] }>("/api/admin/users");
  const trainersApi = useApi<{ trainers: Trainer[] }>("/api/admin/trainers");

  const [form, setForm] = useState({
    fullName: "",
    username: "",
    password: "",
    role: "trainer",
    coachId: ""
  });
  const [ownerId, setOwnerId] = useState("");
  const [diagnosticLog, setDiagnosticLog] = useState<string[]>([]);
  const [diagnosticPending, setDiagnosticPending] = useState<"webhook" | "cron" | null>(null);

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

  async function runWebhookTest(event: FormEvent) {
    event.preventDefault();
    setDiagnosticPending("webhook");
    setDiagnosticLog(["Running webhook test..."]);

    try {
      const data = await api<StravaDiagnosticResponse>("/api/admin/strava/webhook-test", {
        method: "POST",
        body: JSON.stringify({ ownerId: Number(ownerId) })
      });
      setDiagnosticLog(data.log);
    } catch (err: any) {
      setDiagnosticLog([`Error: ${err.message}`]);
    } finally {
      setDiagnosticPending(null);
    }
  }

  async function runCronTest() {
    setDiagnosticPending("cron");
    setDiagnosticLog(["Running cron test..."]);

    try {
      const data = await api<StravaDiagnosticResponse>("/api/admin/strava/cron-run", {
        method: "POST"
      });
      setDiagnosticLog(data.log);
    } catch (err: any) {
      setDiagnosticLog([`Error: ${err.message}`]);
    } finally {
      setDiagnosticPending(null);
    }
  }

  const users = usersApi.data?.users ?? [];
  const trainers = trainersApi.data?.trainers ?? [];

  return (
    <div className="stack">
      <section className="card">
        <div className="section-header">
          <div>
            <h2>Strava Диагностика</h2>
            <p className="muted">
              Проверка webhook по `owner_id` и ручной запуск cron с видимым логом.
            </p>
          </div>
          <button
            type="button"
            className="ghost-button"
            disabled={diagnosticPending !== null}
            onClick={runCronTest}
          >
            {diagnosticPending === "cron" ? "Запуск..." : "Запустить cron"}
          </button>
        </div>

        <form className="form admin-diagnostic-form" onSubmit={runWebhookTest}>
          <label>
            Strava owner_id
            <input
              required
              inputMode="numeric"
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
              placeholder="Например, 12345678"
            />
          </label>
          <button className="primary-button" disabled={diagnosticPending !== null}>
            {diagnosticPending === "webhook" ? "Проверяем..." : "Проверить webhook"}
          </button>
        </form>

        <div className="admin-log-card">
          <div className="admin-log-header">
            <strong>Лог</strong>
            {diagnosticLog.length ? (
              <button
                type="button"
                className="ghost-button admin-log-clear"
                onClick={() => setDiagnosticLog([])}
              >
                Очистить
              </button>
            ) : null}
          </div>
          {diagnosticLog.length ? (
            <div className="admin-log-output">
              {diagnosticLog.map((line, index) => (
                <div key={`${index}-${line}`}>{line}</div>
              ))}
            </div>
          ) : (
            <div className="muted">Здесь появится результат диагностики.</div>
          )}
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
                    <div className="role-badge">{user.role}</div>
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
