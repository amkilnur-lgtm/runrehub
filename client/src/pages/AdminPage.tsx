import { FormEvent, Fragment, useEffect, useState } from "react";

import { api } from "../api";
import { useApi } from "../hooks/useApi";
import { formatDate } from "../lib";

type AdminUser = {
  id: number;
  username: string;
  full_name: string;
  role: string;
  coach_id: number | null;
  coach_name: string | null;
  icu_athlete_id: string | null;
  intervals_last_synced_at: string | null;
  intervals_last_sync_error: string | null;
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

type FitnessSummaryRow = {
  athlete_id: number;
  athlete_name: string;
  week_start: string;
  runs: number;
  score_runs: number;
  estimated_hrmax: number | null;
  week_best_score: number | null;
  aerobic_avg_score: number | null;
  fitness_index: number | null;
};

type WeeklyPreviewItem = {
  athleteUserId: number;
  athleteName: string;
  workoutCount: number;
  totalDistanceMeters: number;
  totalMovingTimeSeconds: number;
  totalElevationGain: number;
  averageSpeed: number | null;
  averageHeartrate: number | null;
  zonePercentages: {
    under130: number;
    from130To150: number;
    from150To162: number;
    from162Plus: number;
  };
};

type WeeklyPreviewState = {
  weekStart: string;
  skipped: number;
  trainerHasChatId: boolean;
  reports: WeeklyPreviewItem[];
};

type MonthlyPreviewState = {
  monthStart: string;
  skipped: number;
  trainerHasChatId: boolean;
  reports: WeeklyPreviewItem[];
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
  const details =
    entry.details && Object.keys(entry.details).length > 0 ? ` ${JSON.stringify(entry.details)}` : "";
  return `${prefix} ${entry.message}${details}`;
}

function getTodayDateInputValue() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getCurrentMonthInputValue() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function formatDistanceKm(distanceMeters: number) {
  return `${(distanceMeters / 1000).toFixed(2)} км`;
}

function formatDuration(seconds: number) {
  const totalSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function formatPace(averageSpeed: number | null) {
  if (!averageSpeed || !Number.isFinite(averageSpeed) || averageSpeed <= 0) {
    return "—";
  }

  const totalSeconds = Math.round(1000 / averageSpeed);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}/км`;
}

function formatHeartRate(averageHeartrate: number | null) {
  if (!averageHeartrate || !Number.isFinite(averageHeartrate)) {
    return "—";
  }

  return `${Math.round(averageHeartrate)} уд/мин`;
}

function formatFitnessScore(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }

  return value.toFixed(2);
}

export function AdminPage() {
  const usersApi = useApi<{ users: AdminUser[] }>("/api/admin/users");
  const trainersApi = useApi<{ trainers: Trainer[] }>("/api/admin/trainers");
  const eventsApi = useApi<{ events: StravaEvent[] }>("/api/admin/events?limit=80");
  const fitnessApi = useApi<{ weeks: number; rows: FitnessSummaryRow[] }>("/api/admin/fitness/summary?weeks=8");
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
  const [previewingTrainerId, setPreviewingTrainerId] = useState<number | null>(null);
  const [weeklyTestingTrainerId, setWeeklyTestingTrainerId] = useState<number | null>(null);
  const [monthlyTestingTrainerId, setMonthlyTestingTrainerId] = useState<number | null>(null);
  const [weeklyWeekDates, setWeeklyWeekDates] = useState<Record<number, string>>({});
  const [monthlyMonthDates, setMonthlyMonthDates] = useState<Record<number, string>>({});
  const [weeklyPreviews, setWeeklyPreviews] = useState<Record<number, WeeklyPreviewState>>({});
  const [monthlyPreviews, setMonthlyPreviews] = useState<Record<number, MonthlyPreviewState>>({});
  const [reportMenuUserId, setReportMenuUserId] = useState<number | null>(null);
  const [intervalsFormUserId, setIntervalsFormUserId] = useState<number | null>(null);
  const [intervalsDrafts, setIntervalsDrafts] = useState<
    Record<number, { icuAthleteId: string; apiKey: string }>
  >({});
  const [savingIntervalsId, setSavingIntervalsId] = useState<number | null>(null);
  const [syncingIntervalsId, setSyncingIntervalsId] = useState<number | null>(null);

  useEffect(() => {
    if (reportMenuUserId === null) {
      return undefined;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!(event.target as HTMLElement).closest(".report-menu")) {
        setReportMenuUserId(null);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setReportMenuUserId(null);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [reportMenuUserId]);
  const [sendingAthleteWeeklyId, setSendingAthleteWeeklyId] = useState<number | null>(null);
  const [sendingAthleteMonthlyId, setSendingAthleteMonthlyId] = useState<number | null>(null);

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

  useEffect(() => {
    setMonthlyMonthDates((current) => {
      const next = { ...current };
      for (const trainer of telegramApi.data?.trainers ?? []) {
        next[trainer.id] ||= getCurrentMonthInputValue();
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

  async function previewWeeklyTelegramTest(trainerId: number) {
    const weekDate = weeklyWeekDates[trainerId] ?? getTodayDateInputValue();
    setPreviewingTrainerId(trainerId);
    try {
      const result = await api<{
        ok: boolean;
        weekStart: string;
        skipped: number;
        trainerHasChatId: boolean;
        reports: WeeklyPreviewItem[];
      }>(`/api/admin/trainers/${trainerId}/telegram/weekly-preview`, {
        method: "POST",
        body: JSON.stringify({ weekDate })
      });

      setWeeklyPreviews((current) => ({
        ...current,
        [trainerId]: {
          weekStart: result.weekStart,
          skipped: result.skipped,
          trainerHasChatId: result.trainerHasChatId,
          reports: result.reports
        }
      }));
    } catch (err: any) {
      alert(`Ошибка preview weekly report: ${err.message}`);
    } finally {
      setPreviewingTrainerId(null);
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

  async function previewMonthlyTelegramTest(trainerId: number) {
    const monthDate = monthlyMonthDates[trainerId] ?? getCurrentMonthInputValue();
    setPreviewingTrainerId(trainerId);
    try {
      const result = await api<{
        ok: boolean;
        monthStart: string;
        skipped: number;
        trainerHasChatId: boolean;
        reports: WeeklyPreviewItem[];
      }>(`/api/admin/trainers/${trainerId}/telegram/monthly-preview`, {
        method: "POST",
        body: JSON.stringify({ monthDate })
      });

      setMonthlyPreviews((current) => ({
        ...current,
        [trainerId]: {
          monthStart: result.monthStart,
          skipped: result.skipped,
          trainerHasChatId: result.trainerHasChatId,
          reports: result.reports
        }
      }));
    } catch (err: any) {
      alert(`Ошибка preview monthly report: ${err.message}`);
    } finally {
      setPreviewingTrainerId(null);
    }
  }

  async function sendMonthlyTelegramTest(trainerId: number) {
    const monthDate = monthlyMonthDates[trainerId] ?? getCurrentMonthInputValue();
    setMonthlyTestingTrainerId(trainerId);
    try {
      const result = await api<{
        ok: boolean;
        monthStart: string;
        sent: number;
        skipped: number;
      }>(`/api/admin/trainers/${trainerId}/telegram/monthly-test`, {
        method: "POST",
        body: JSON.stringify({ monthDate })
      });
      alert(
        `Monthly report отправлен.\nМесяц: ${result.monthStart}\nОтправлено: ${result.sent}\nПропущено без тренировок: ${result.skipped}`
      );
      eventsApi.refresh();
      telegramApi.refresh();
    } catch (err: any) {
      alert(`Ошибка monthly report: ${err.message}`);
    } finally {
      setMonthlyTestingTrainerId(null);
    }
  }

  async function saveIntervalsConnection(userId: number) {
    const draft = intervalsDrafts[userId];
    if (!draft?.icuAthleteId.trim() || !draft?.apiKey.trim()) {
      alert("Заполните Athlete ID и API key из intervals.icu");
      return;
    }

    setSavingIntervalsId(userId);
    try {
      const result = await api<{ ok: boolean; icuAthleteId: string; athleteName: string | null }>(
        `/api/admin/athletes/${userId}/intervals`,
        {
          method: "PUT",
          body: JSON.stringify({
            icuAthleteId: draft.icuAthleteId.trim(),
            apiKey: draft.apiKey.trim()
          })
        }
      );
      alert(
        `intervals.icu подключён (${result.icuAthleteId}${
          result.athleteName ? ` · ${result.athleteName}` : ""
        }). Первая синхронизация подтянет тренировки за 90 дней.`
      );
      setIntervalsFormUserId(null);
      setIntervalsDrafts((current) => ({ ...current, [userId]: { icuAthleteId: "", apiKey: "" } }));
      usersApi.refresh();
    } catch (err: any) {
      alert(`Не удалось подключить intervals.icu: ${err.message}`);
    } finally {
      setSavingIntervalsId(null);
    }
  }

  async function disconnectIntervals(userId: number, username: string) {
    if (!window.confirm(`Отключить intervals.icu у @${username}? Тренировки останутся в базе.`)) {
      return;
    }
    await api(`/api/admin/athletes/${userId}/intervals`, { method: "DELETE" });
    usersApi.refresh();
  }

  async function syncIntervalsNow(userId: number) {
    setSyncingIntervalsId(userId);
    try {
      const result = await api<{ synced: boolean; imported?: number }>(
        `/api/admin/athletes/${userId}/intervals/sync`,
        { method: "POST" }
      );
      alert(
        result.synced
          ? `Синхронизация завершена: импортировано тренировок — ${result.imported}.`
          : "Синхронизация уже выполняется."
      );
      usersApi.refresh();
      eventsApi.refresh();
    } catch (err: any) {
      alert(`Ошибка синхронизации: ${err.message}`);
    } finally {
      setSyncingIntervalsId(null);
    }
  }

  async function sendAthleteWeeklyReport(athleteId: number, period: "current" | "previous") {
    setSendingAthleteWeeklyId(athleteId);
    try {
      const result = await api<{
        ok: boolean;
        athleteName: string;
        coachName: string;
        weekStart: string;
      }>(`/api/admin/athletes/${athleteId}/telegram/weekly-send`, {
        method: "POST",
        body: JSON.stringify({ period })
      });
      alert(
        `Недельный отчет отправлен.\nСпортсмен: ${result.athleteName}\nТренер: ${result.coachName}\nНеделя: ${result.weekStart}`
      );
      eventsApi.refresh();
    } catch (err: any) {
      alert(`Ошибка отправки weekly report: ${err.message}`);
    } finally {
      setSendingAthleteWeeklyId(null);
    }
  }

  async function sendAthleteMonthlyReport(athleteId: number, period: "current" | "previous") {
    setSendingAthleteMonthlyId(athleteId);
    try {
      const result = await api<{
        ok: boolean;
        athleteName: string;
        coachName: string;
        monthStart: string;
      }>(`/api/admin/athletes/${athleteId}/telegram/monthly-send`, {
        method: "POST",
        body: JSON.stringify({ period })
      });
      alert(
        `Месячный отчет отправлен.\nСпортсмен: ${result.athleteName}\nТренер: ${result.coachName}\nМесяц: ${result.monthStart}`
      );
      eventsApi.refresh();
    } catch (err: any) {
      alert(`Ошибка отправки monthly report: ${err.message}`);
    } finally {
      setSendingAthleteMonthlyId(null);
    }
  }

  const users = usersApi.data?.users ?? [];
  const trainers = trainersApi.data?.trainers ?? [];
  const events = eventsApi.data?.events ?? [];
  const fitnessRows = (fitnessApi.data?.rows ?? []).filter(
    (row) => row.runs > 0 || row.fitness_index != null
  );
  const telegramTrainers = telegramApi.data?.trainers ?? [];
  const logText = events.map(formatLogLine).join("\n");

  return (
    <div className="stack">
      <div className="grid two-columns">
        <section className="card">
          <h2>Создать учетку</h2>
          <form className="form" onSubmit={onSubmit}>
            <label>
              Имя
              <input
                required
                value={form.fullName}
                onChange={(event) => setForm({ ...form, fullName: event.target.value })}
              />
            </label>
            <label>
              Логин
              <input
                required
                value={form.username}
                onChange={(event) => setForm({ ...form, username: event.target.value })}
              />
            </label>
            <label>
              Пароль
              <input
                required
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
              />
            </label>
            <label>
              Роль
              <select
                value={form.role}
                onChange={(event) => setForm({ ...form, role: event.target.value, coachId: "" })}
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
                  onChange={(event) => setForm({ ...form, coachId: event.target.value })}
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
          {usersApi.error ? (
            <p className="muted" style={{ color: "var(--danger)" }}>
              {usersApi.error}
            </p>
          ) : null}
          <div className="list">
            {users.map((user) => {
              const intervalsDraft = intervalsDrafts[user.id] ?? { icuAthleteId: "", apiKey: "" };
              const isIntervalsFormOpen = intervalsFormUserId === user.id;
              const intervalsStatus =
                user.role !== "athlete"
                  ? null
                  : user.icu_athlete_id
                    ? user.intervals_last_sync_error
                      ? `intervals.icu: ${user.icu_athlete_id} · ошибка синхронизации`
                      : user.intervals_last_synced_at
                        ? `intervals.icu: ${user.icu_athlete_id} · синхр. ${formatDate(user.intervals_last_synced_at)}`
                        : `intervals.icu: ${user.icu_athlete_id} · ждёт первой синхронизации`
                    : "синхронизация не подключена";

              return (
              <Fragment key={user.id}>
              <div className="list-row">
                <div>
                  <strong>{user.full_name}</strong>
                  <div className="muted">@{user.username}</div>
                  {intervalsStatus ? (
                    <div
                      className="muted"
                      style={
                        user.intervals_last_sync_error ? { color: "var(--danger)" } : undefined
                      }
                    >
                      {intervalsStatus}
                    </div>
                  ) : null}
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
                    {user.role === "athlete" ? (
                      <div className="report-menu">
                        <button
                          type="button"
                          className="ghost-button compact-button"
                          aria-haspopup="menu"
                          aria-expanded={reportMenuUserId === user.id}
                          disabled={
                            sendingAthleteWeeklyId === user.id || sendingAthleteMonthlyId === user.id
                          }
                          onClick={() =>
                            setReportMenuUserId(reportMenuUserId === user.id ? null : user.id)
                          }
                        >
                          {sendingAthleteWeeklyId === user.id || sendingAthleteMonthlyId === user.id
                            ? "Отправляю..."
                            : "Отчёт в Telegram ▾"}
                        </button>
                        {reportMenuUserId === user.id ? (
                          <div className="report-menu-popover" role="menu">
                            <button
                              type="button"
                              className="report-menu-item"
                              onClick={() => {
                                setReportMenuUserId(null);
                                sendAthleteWeeklyReport(user.id, "current");
                              }}
                            >
                              Недельный · текущая неделя
                            </button>
                            <button
                              type="button"
                              className="report-menu-item"
                              onClick={() => {
                                setReportMenuUserId(null);
                                sendAthleteWeeklyReport(user.id, "previous");
                              }}
                            >
                              Недельный · прошлая неделя
                            </button>
                            <button
                              type="button"
                              className="report-menu-item"
                              onClick={() => {
                                setReportMenuUserId(null);
                                sendAthleteMonthlyReport(user.id, "current");
                              }}
                            >
                              Месячный · этот месяц
                            </button>
                            <button
                              type="button"
                              className="report-menu-item"
                              onClick={() => {
                                setReportMenuUserId(null);
                                sendAthleteMonthlyReport(user.id, "previous");
                              }}
                            >
                              Месячный · прошлый месяц
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {user.role === "athlete" ? (
                      <button
                        type="button"
                        className="ghost-button compact-button"
                        aria-expanded={isIntervalsFormOpen}
                        onClick={() =>
                          setIntervalsFormUserId(isIntervalsFormOpen ? null : user.id)
                        }
                      >
                        intervals.icu
                      </button>
                    ) : null}
                    {user.role !== "admin" ? (
                      <button
                        type="button"
                        className="ghost-button compact-button"
                        style={{ color: "var(--danger)" }}
                        onClick={() => deleteUser(user.id, user.username)}
                      >
                        Удалить
                      </button>
                    ) : null}
                  </div>
                  {user.coach_name ? <div className="muted">Тренер: {user.coach_name}</div> : null}
                </div>
              </div>
              {isIntervalsFormOpen ? (
                <div className="intervals-panel">
                  {user.intervals_last_sync_error ? (
                    <div className="error-box">{user.intervals_last_sync_error}</div>
                  ) : null}
                  <div className="intervals-panel-fields">
                    <label className="admin-telegram-field">
                      Athlete ID
                      <input
                        placeholder="i123456"
                        value={intervalsDraft.icuAthleteId}
                        onChange={(event) =>
                          setIntervalsDrafts((current) => ({
                            ...current,
                            [user.id]: { ...intervalsDraft, icuAthleteId: event.target.value }
                          }))
                        }
                      />
                    </label>
                    <label className="admin-telegram-field">
                      API key
                      <input
                        placeholder="ключ из Settings → Developer"
                        value={intervalsDraft.apiKey}
                        onChange={(event) =>
                          setIntervalsDrafts((current) => ({
                            ...current,
                            [user.id]: { ...intervalsDraft, apiKey: event.target.value }
                          }))
                        }
                      />
                    </label>
                  </div>
                  <div className="admin-telegram-actions">
                    <button
                      type="button"
                      className="primary-button compact-button"
                      onClick={() => saveIntervalsConnection(user.id)}
                      disabled={savingIntervalsId === user.id}
                    >
                      {savingIntervalsId === user.id ? "Проверяю ключ..." : "Сохранить и проверить"}
                    </button>
                    {user.icu_athlete_id ? (
                      <>
                        <button
                          type="button"
                          className="ghost-button compact-button"
                          onClick={() => syncIntervalsNow(user.id)}
                          disabled={syncingIntervalsId === user.id}
                        >
                          {syncingIntervalsId === user.id ? "Синхронизирую..." : "Синхронизировать"}
                        </button>
                        <button
                          type="button"
                          className="ghost-button compact-button"
                          style={{ color: "var(--danger)" }}
                          onClick={() => disconnectIntervals(user.id, user.username)}
                        >
                          Отключить
                        </button>
                      </>
                    ) : null}
                  </div>
                  <div className="muted">
                    Спортсмен берёт ключ в intervals.icu: Settings → Developer → API key. Athlete ID
                    виден в адресе профиля (например, i123456).
                  </div>
                </div>
              ) : null}
              </Fragment>
              );
            })}
          </div>
        </section>
      </div>

      <section className="card">
        <div className="section-header">
          <div>
            <h2>Журнал событий</h2>
            <p className="muted">
              Последние серверные события синхронизации и cron. Обновляй список, чтобы видеть новые
              срабатывания.
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
            <div className="muted">Пока нет событий. Логи появятся после webhook или cron-тиков.</div>
          ) : null}
          {!eventsApi.loading && !eventsApi.error && events.length > 0 ? (
            <textarea className="admin-log-output" value={logText} readOnly spellCheck={false} />
          ) : null}
        </div>
      </section>

      <section className="card">
        <div className="section-header">
          <div>
            <h2>Индекс формы</h2>
            <p className="muted">
              Оценка беговой формы по неделям. В расчёт попадают только пробежки с надёжным GPS и
              пульсом — если таких нет, у недели не будет оценки. Это внутренняя метрика, не VO2max.
            </p>
          </div>
          <button type="button" className="ghost-button" onClick={fitnessApi.refresh}>
            Обновить
          </button>
        </div>

        {fitnessApi.loading ? <div className="muted">Загрузка сводки...</div> : null}
        {fitnessApi.error ? <div className="error-box">{fitnessApi.error}</div> : null}
        {!fitnessApi.loading && !fitnessApi.error ? (
          <div className="list">
            {fitnessRows.map((row) => (
              <div key={`${row.athlete_id}-${row.week_start}`} className="list-row">
                <div>
                  <strong>{row.athlete_name}</strong>
                  <div className="muted">
                    Неделя с {new Date(row.week_start).toLocaleDateString("ru-RU")} · пробежек: {row.runs} · в расчёте: {row.score_runs}
                    {row.estimated_hrmax ? ` · оценка макс. пульса: ${Math.round(row.estimated_hrmax)}` : ""}
                  </div>
                </div>
                <div className="align-right">
                  {row.fitness_index != null ? (
                    <>
                      <div>
                        Форма: <strong>{formatFitnessScore(row.fitness_index)}</strong>
                      </div>
                      <div className="muted">
                        лучшая за неделю {formatFitnessScore(row.week_best_score)} · аэробная{" "}
                        {formatFitnessScore(row.aerobic_avg_score)}
                      </div>
                    </>
                  ) : (
                    <div className="muted">нет данных для расчёта</div>
                  )}
                </div>
              </div>
            ))}
            {fitnessRows.length === 0 ? (
              <div className="muted">
                Пока нет недель с пробежками — оценки появятся после синхронизации тренировок из
                intervals.icu.
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="card">
        <div className="section-header">
          <div>
            <h2>Telegram тренеров</h2>
            <p className="muted">
              Здесь можно задать chat id, включить уведомления, проверить обычный тест и посмотреть
              превью недельного отчета перед отправкой.
            </p>
          </div>
          <button type="button" className="ghost-button" onClick={telegramApi.refresh}>
            Обновить
          </button>
        </div>

        {telegramApi.data && !telegramApi.data.configured ? (
          <div className="admin-telegram-hint">
            Telegram bot не настроен на сервере. Добавь <code>TELEGRAM_BOT_TOKEN</code> в окружение,
            чтобы включить отправку.
          </div>
        ) : null}

        {telegramApi.error ? <div className="error-box">{telegramApi.error}</div> : null}

        <div className="admin-telegram-list">
          {telegramTrainers.map((trainer) => {
            const draft = telegramDrafts[trainer.id] ?? {
              chatId: trainer.telegram_chat_id ?? "",
              notificationsEnabled: trainer.telegram_notifications_enabled
            };
            const weeklyPreview = weeklyPreviews[trainer.id];
            const monthlyPreview = monthlyPreviews[trainer.id];

            return (
              <div key={trainer.id} className="admin-telegram-row inset-card">
                <div className="admin-telegram-topline">
                  <div>
                    <strong>{trainer.full_name}</strong>
                    <div className="muted">
                      {trainer.telegram_chat_id ? "Chat ID задан" : "Chat ID не задан"} · в очереди:{" "}
                      {trainer.pending_jobs} · отправлено: {trainer.sent_jobs}
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
                  Telegram chat ID
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
                    onClick={() => previewWeeklyTelegramTest(trainer.id)}
                    disabled={previewingTrainerId === trainer.id}
                  >
                    {previewingTrainerId === trainer.id ? "Готовлю превью..." : "Превью недели"}
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => sendWeeklyTelegramTest(trainer.id)}
                    disabled={weeklyTestingTrainerId === trainer.id || !draft.chatId.trim()}
                  >
                    {weeklyTestingTrainerId === trainer.id ? "Отправляю..." : "Тест недели"}
                  </button>
                </div>

                {weeklyPreview ? (
                  <div className="admin-log-card">
                    <div className="muted" style={{ marginBottom: 12 }}>
                      Неделя: {weeklyPreview.weekStart} · отчетов: {weeklyPreview.reports.length} ·
                      пропущено без тренировок: {weeklyPreview.skipped}
                      {!weeklyPreview.trainerHasChatId ? " · chat id не задан" : ""}
                    </div>
                    {weeklyPreview.reports.length === 0 ? (
                      <div className="muted">Для выбранной недели нет спортсменов с тренировками.</div>
                    ) : (
                      <div className="list">
                        {weeklyPreview.reports.map((report) => (
                          <div key={report.athleteUserId} className="list-row">
                            <div>
                              <strong>{report.athleteName}</strong>
                              <div className="muted">
                                Тренировок: {report.workoutCount} · Объем:{" "}
                                {formatDistanceKm(report.totalDistanceMeters)} · Время:{" "}
                                {formatDuration(report.totalMovingTimeSeconds)} · Набор:{" "}
                                {Math.round(report.totalElevationGain)} м
                              </div>
                              <div className="muted">
                                Темп: {formatPace(report.averageSpeed)} · Пульс:{" "}
                                {formatHeartRate(report.averageHeartrate)}
                              </div>
                              <div className="muted">
                                Зоны: до 130 {report.zonePercentages.under130}% · 130-150{" "}
                                {report.zonePercentages.from130To150}% · 150-162{" "}
                                {report.zonePercentages.from150To162}% · 162+{" "}
                                {report.zonePercentages.from162Plus}%
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}

                <div className="admin-telegram-actions">
                  <label className="admin-telegram-field" style={{ marginBottom: 0 }}>
                    Месяц отчета
                    <input
                      type="month"
                      value={monthlyMonthDates[trainer.id] ?? getCurrentMonthInputValue()}
                      onChange={(event) =>
                        setMonthlyMonthDates((current) => ({
                          ...current,
                          [trainer.id]: event.target.value
                        }))
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => previewMonthlyTelegramTest(trainer.id)}
                    disabled={previewingTrainerId === trainer.id}
                  >
                    {previewingTrainerId === trainer.id ? "Готовлю превью..." : "Превью месяца"}
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => sendMonthlyTelegramTest(trainer.id)}
                    disabled={monthlyTestingTrainerId === trainer.id || !draft.chatId.trim()}
                  >
                    {monthlyTestingTrainerId === trainer.id ? "Отправляю..." : "Тест месяца"}
                  </button>
                </div>

                {monthlyPreview ? (
                  <div className="admin-log-card">
                    <div className="muted" style={{ marginBottom: 12 }}>
                      Месяц: {monthlyPreview.monthStart} · отчетов: {monthlyPreview.reports.length} ·
                      пропущено без тренировок: {monthlyPreview.skipped}
                      {!monthlyPreview.trainerHasChatId ? " · chat id не задан" : ""}
                    </div>
                    {monthlyPreview.reports.length === 0 ? (
                      <div className="muted">Для выбранного месяца нет спортсменов с тренировками.</div>
                    ) : (
                      <div className="list">
                        {monthlyPreview.reports.map((report) => (
                          <div key={report.athleteUserId} className="list-row">
                            <div>
                              <strong>{report.athleteName}</strong>
                              <div className="muted">
                                Тренировок: {report.workoutCount} · Объем:{" "}
                                {formatDistanceKm(report.totalDistanceMeters)} · Время:{" "}
                                {formatDuration(report.totalMovingTimeSeconds)} · Набор:{" "}
                                {Math.round(report.totalElevationGain)} м
                              </div>
                              <div className="muted">
                                Темп: {formatPace(report.averageSpeed)} · Пульс:{" "}
                                {formatHeartRate(report.averageHeartrate)}
                              </div>
                              <div className="muted">
                                Зоны: до 130 {report.zonePercentages.under130}% · 130-150{" "}
                                {report.zonePercentages.from130To150}% · 150-162{" "}
                                {report.zonePercentages.from150To162}% · 162+{" "}
                                {report.zonePercentages.from162Plus}%
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

    </div>
  );
}
