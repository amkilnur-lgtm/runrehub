import { FormEvent, useEffect, useState } from "react";

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

type TrainerTelegramSettings = {
  id: number;
  full_name: string;
  telegram_chat_id: string | null;
  telegram_notifications_enabled: boolean;
  pending_jobs: number;
  sent_jobs: number;
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

function getTodayDateInputValue() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function AdminPage() {
  const usersApi = useApi<{ users: AdminUser[] }>("/api/admin/users");
  const trainersApi = useApi<{ trainers: Trainer[] }>("/api/admin/trainers");
  const eventsApi = useApi<{ events: StravaEvent[] }>("/api/admin/strava/events?limit=80");
  const telegramApi = useApi<{
    configured: boolean;
    trainers: TrainerTelegramSettings[];
  }>("/api/admin/trainers/telegram");

  const [form, setForm] = useState({
    fullName: "",
    username: "",
    password: "",
    role: "trainer",
    coachId: ""
  });
  const [telegramDrafts, setTelegramDrafts] = useState<
    Record<number, { chatId: string; notificationsEnabled: boolean }>
  >({});
  const [savingTrainerId, setSavingTrainerId] = useState<number | null>(null);
  const [testingTrainerId, setTestingTrainerId] = useState<number | null>(null);
  const [weeklyTestingTrainerId, setWeeklyTestingTrainerId] = useState<number | null>(null);
  const [weeklyWeekDates, setWeeklyWeekDates] = useState<Record<number, string>>({});

  useEffect(() => {
    const nextDrafts = Object.fromEntries(
      (telegramApi.data?.trainers ?? []).map((trainer) => [
        trainer.id,
        {
          chatId: trainer.telegram_chat_id ?? "",
          notificationsEnabled: trainer.telegram_notifications_enabled
        }
      ])
    );

    setTelegramDrafts(nextDrafts);
  }, [telegramApi.data]);

  useEffect(() => {
    setWeeklyWeekDates((current) => {
      const next = { ...current };
      for (const trainer of telegramApi.data?.trainers ?? []) {
        next[trainer.id] ||= getTodayDateInputValue();
      }
      return next;
    });
  }, [telegramApi.data]);

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

  async function saveTelegramSettings(trainerId: number) {
    const draft = telegramDrafts[trainerId];
    if (!draft) {
      return;
    }

    setSavingTrainerId(trainerId);
    try {
      await api(`/api/admin/trainers/${trainerId}/telegram`, {
        method: "PUT",
        body: JSON.stringify({
          chatId: draft.chatId.trim() ? draft.chatId.trim() : null,
          notificationsEnabled: draft.notificationsEnabled
        })
      });
      telegramApi.refresh();
    } catch (err: any) {
      alert(`Ошибка сохранения Telegram: ${err.message}`);
    } finally {
      setSavingTrainerId(null);
    }
  }

  async function sendTelegramTest(trainerId: number) {
    setTestingTrainerId(trainerId);
    try {
      await api(`/api/admin/trainers/${trainerId}/telegram/test`, {
        method: "POST"
      });
      alert("Тестовое сообщение отправлено");
    } catch (err: any) {
      alert(`Ошибка тестового сообщения: ${err.message}`);
    } finally {
      setTestingTrainerId(null);
    }
  }

  async function sendWeeklyTelegramTest(trainerId: number) {
    const weekDate = weeklyWeekDates[trainerId] ?? getTodayDateInputValue();
    setWeeklyTestingTrainerId(trainerId);
    try {
      const result = await api<{
        ok: boolean;
        weekStart: string;
        sent: number;
        skipped: number;
      }>(`/api/admin/trainers/${trainerId}/telegram/weekly-test`, {
        method: "POST",
        body: JSON.stringify({ weekDate })
      });
      alert(
        `Weekly report отправлен.\nНеделя: ${result.weekStart}\nОтправлено: ${result.sent}\nПропущено без тренировок: ${result.skipped}`
      );
      eventsApi.refresh();
      telegramApi.refresh();
    } catch (err: any) {
      alert(`Ошибка weekly report: ${err.message}`);
    } finally {
      setWeeklyTestingTrainerId(null);
    }
  }

  const users = usersApi.data?.users ?? [];
  const trainers = trainersApi.data?.trainers ?? [];
  const events = eventsApi.data?.events ?? [];
  const telegramTrainers = telegramApi.data?.trainers ?? [];
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

      <section className="card">
        <div className="section-header">
          <div>
            <h2>Telegram тренеров</h2>
            <p className="muted">
              Здесь можно задать chat id, включить уведомления о новых пробежках и отправить тест.
            </p>
          </div>
          <button type="button" className="ghost-button" onClick={telegramApi.refresh}>
            Обновить
          </button>
        </div>

        {telegramApi.data && !telegramApi.data.configured ? (
          <div className="admin-telegram-hint">
            Telegram bot не настроен на сервере. Добавь <code>TELEGRAM_BOT_TOKEN</code> в
            окружение, чтобы включить отправку.
          </div>
        ) : null}

        {telegramApi.error ? <div className="error-box">{telegramApi.error}</div> : null}

        <div className="admin-telegram-list">
          {telegramTrainers.map((trainer) => {
            const draft = telegramDrafts[trainer.id] ?? {
              chatId: trainer.telegram_chat_id ?? "",
              notificationsEnabled: trainer.telegram_notifications_enabled
            };

            return (
              <div key={trainer.id} className="admin-telegram-row inset-card">
                <div className="admin-telegram-topline">
                  <div>
                    <strong>{trainer.full_name}</strong>
                    <div className="muted">
                      {trainer.telegram_chat_id ? "Chat id задан" : "Chat id не задан"} · pending:{" "}
                      {trainer.pending_jobs} · sent: {trainer.sent_jobs}
                    </div>
                  </div>

                  <label className="admin-telegram-toggle">
                    <input
                      type="checkbox"
                      checked={draft.notificationsEnabled}
                      onChange={(event) =>
                        setTelegramDrafts((current) => ({
                          ...current,
                          [trainer.id]: {
                            ...draft,
                            notificationsEnabled: event.target.checked
                          }
                        }))
                      }
                    />
                    <span>Уведомления включены</span>
                  </label>
                </div>

                <label className="admin-telegram-field">
                  Telegram chat id
                  <input
                    value={draft.chatId}
                    placeholder="Например: 123456789"
                    onChange={(event) =>
                      setTelegramDrafts((current) => ({
                        ...current,
                        [trainer.id]: {
                          ...draft,
                          chatId: event.target.value
                        }
                      }))
                    }
                  />
                </label>

                <div className="admin-telegram-actions">
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => saveTelegramSettings(trainer.id)}
                    disabled={savingTrainerId === trainer.id}
                  >
                    {savingTrainerId === trainer.id ? "Сохраняю..." : "Сохранить"}
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => sendTelegramTest(trainer.id)}
                    disabled={testingTrainerId === trainer.id || !draft.chatId.trim()}
                  >
                    {testingTrainerId === trainer.id ? "Отправляю..." : "Тест"}
                  </button>
                </div>
                <div className="admin-telegram-actions">
                  <label className="admin-telegram-field" style={{ marginBottom: 0 }}>
                    Дата недели
                    <input
                      type="date"
                      value={weeklyWeekDates[trainer.id] ?? getTodayDateInputValue()}
                      onChange={(event) =>
                        setWeeklyWeekDates((current) => ({
                          ...current,
                          [trainer.id]: event.target.value
                        }))
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => sendWeeklyTelegramTest(trainer.id)}
                    disabled={weeklyTestingTrainerId === trainer.id || !draft.chatId.trim()}
                  >
                    {weeklyTestingTrainerId === trainer.id ? "Отправляю weekly..." : "Weekly test"}
                  </button>
                </div>
              </div>
            );
          })}
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
