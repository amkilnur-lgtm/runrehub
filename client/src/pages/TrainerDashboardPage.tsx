import { useState } from "react";
import { Link } from "react-router-dom";

import { GroupWeeksTable, type GroupWeeksAthlete } from "../components/GroupWeeksTable";
import { UserAvatar } from "../components/UserAvatar";
import { useAuth } from "../components/AuthProvider";
import { useApi } from "../hooks/useApi";
import { formatAgo, formatPace, formatKm, greetingFor, pluralRu } from "../lib";

type StatsPeriodKey = "week" | "month" | "year" | "allTime";

type GroupPeriodStats = {
  athlete_count: number;
  active_athlete_count: number;
  workout_count: number;
  distance_meters: number;
  moving_time_seconds: number;
};

type DashboardData = {
  athletes: Array<{
    id: number;
    full_name: string;
    username: string;
    avatar_url: string | null;
    last_workout_at: string | null;
  }>;
  recentWorkouts: Array<{
    id: number;
    user_id: number;
    athlete_name: string;
    athlete_avatar_url: string | null;
    name: string;
    start_date: string;
    distance_meters: number;
    moving_time_seconds: number;
    average_speed: number | null;
    average_heartrate: number | null;
    has_feedback: boolean;
  }>;
  connectedAthletesCount: number;
  feedback: { pendingCount: number; oldestPendingAt: string | null; windowDays: number };
  groupWeeks: { weekStarts: string[]; athletes: Array<{ id: number; distances: number[] }> };
  stats: Record<StatsPeriodKey, GroupPeriodStats>;
  topAthletesThisWeek: Array<{
    id: number;
    full_name: string;
    avatar_url: string | null;
    week_distance_meters: number;
    week_workout_count: number;
  }>;
};

const statsPeriods: Array<{ key: StatsPeriodKey; label: string; phrase: string }> = [
  { key: "week", label: "Неделя", phrase: "на этой неделе" },
  { key: "month", label: "Месяц", phrase: "в этом месяце" },
  { key: "year", label: "Год", phrase: "в этом году" },
  { key: "allTime", label: "Всё время", phrase: "за всё время" }
];

const RECENT_LIMIT = 8;

function formatHoursMinutes(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return { hours, minutes };
}

function formatDaysAgo(value: string) {
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
  if (days <= 0) return "сегодня";
  if (days === 1) return "вчера";
  return `${days} ${pluralRu(days, "день", "дня", "дней")} назад`;
}

export function TrainerDashboardPage() {
  const { user } = useAuth();
  const { data, loading, error } = useApi<DashboardData>("/api/trainer/dashboard");
  const [period, setPeriod] = useState<StatsPeriodKey>("week");

  if (loading) {
    return (
      <div className="page-stack">
        <div className="skeleton-block" style={{ height: 72 }} />
        <div className="skeleton-block" style={{ height: 120 }} />
        <div className="skeleton-block" style={{ height: 420 }} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <section className="panel panel-pad">
        <h2 className="panel-title">Не удалось загрузить кабинет</h2>
        <p className="muted">{error || "Попробуйте обновить страницу."}</p>
      </section>
    );
  }

  const stats = data.stats[period];
  const periodInfo = statsPeriods.find((item) => item.key === period)!;
  const time = formatHoursMinutes(stats.moving_time_seconds);
  const firstName = user?.fullName?.split(" ")[0] ?? "";
  const weekStats = data.stats.week;

  const tableAthletes: GroupWeeksAthlete[] = data.athletes.map((athlete) => ({
    id: athlete.id,
    fullName: athlete.full_name,
    avatarUrl: athlete.avatar_url,
    lastWorkoutAt: athlete.last_workout_at,
    distances: data.groupWeeks.athletes.find((row) => row.id === athlete.id)?.distances ?? []
  }));

  const pending = data.feedback.pendingCount;
  const leadersWithData = data.topAthletesThisWeek.filter((athlete) => athlete.week_distance_meters > 0);
  const leaderMax = Math.max(...leadersWithData.map((athlete) => athlete.week_distance_meters), 1);
  const inactive = data.athletes.filter(
    (athlete) => !athlete.last_workout_at || Date.now() - new Date(athlete.last_workout_at).getTime() >= 5 * 86_400_000
  );

  return (
    <div className="page-stack">
      <div className="page-head">
        <div>
          <h1 className="page-title">
            {greetingFor(new Date())}
            {firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="page-subtitle">
            Бегали на этой неделе {weekStats.active_athlete_count} из{" "}
            {weekStats.athlete_count} {pluralRu(weekStats.athlete_count, "спортсмена", "спортсменов", "спортсменов")}
          </p>
        </div>
        <div className="segmented" role="tablist" aria-label="Период">
          {statsPeriods.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={item.key === period}
              className={item.key === period ? "segmented-item is-active" : "segmented-item"}
              onClick={() => setPeriod(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <section className="kpi-strip" aria-label={`Сводка группы ${periodInfo.phrase}`}>
        <div className="kpi">
          <div className="kpi-label">Километраж группы</div>
          <div className="kpi-value num">
            {formatKm(stats.distance_meters)}
            <small>км</small>
          </div>
          <div className="kpi-note">{periodInfo.phrase}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Тренировок</div>
          <div className="kpi-value num">{stats.workout_count}</div>
          <div className="kpi-note">
            {stats.active_athlete_count
              ? `в среднем ${(stats.workout_count / stats.active_athlete_count).toFixed(1).replace(".", ",")} на бегавшего`
              : "пока ни одной"}
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Время в беге</div>
          <div className="kpi-value num">
            {time.hours}
            <small>ч</small> {time.minutes}
            <small>м</small>
          </div>
          <div className="kpi-note">{periodInfo.phrase}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Ждут комментария</div>
          <div className={pending ? "kpi-value num is-accent" : "kpi-value num"}>{pending}</div>
          <div className="kpi-note">
            {pending && data.feedback.oldestPendingAt
              ? `самая старая — ${formatDaysAgo(data.feedback.oldestPendingAt)}`
              : `за последние ${data.feedback.windowDays} дней всё прокомментировано`}
          </div>
        </div>
      </section>

      {inactive.length ? (
        <div className="notice notice-warn" role="status">
          <strong>Не бегали 5+ дней:</strong> {inactive.map((athlete) => athlete.full_name.split(" ")[0]).join(", ")}
        </div>
      ) : null}

      <GroupWeeksTable weekStarts={data.groupWeeks.weekStarts} athletes={tableAthletes} />

      <div className="split">
        <section className="panel split-main">
          <div className="panel-head">
            <h2 className="panel-title">Последние пробежки</h2>
            <span className="panel-hint">Сначала новые</span>
          </div>
          {data.recentWorkouts.length === 0 ? (
            <p className="empty">Пробежки появятся здесь, как только спортсмены синхронизируют часы.</p>
          ) : (
            <ul className="run-list">
              {data.recentWorkouts.slice(0, RECENT_LIMIT).map((workout) => (
                <li key={workout.id}>
                  <Link className="run-row" to={`/trainer/workouts/${workout.id}`}>
                    <UserAvatar fullName={workout.athlete_name} avatarUrl={workout.athlete_avatar_url} className="avatar-sm" ariaHidden />
                    <div className="run-row-main">
                      <strong>{workout.athlete_name}</strong>
                      <span>
                        {workout.name} · {formatAgo(workout.start_date)}
                      </span>
                    </div>
                    <div className="run-metric num">
                      {formatKm(workout.distance_meters)}
                      <small>км</small>
                    </div>
                    <div className="run-metric num run-metric-opt">
                      {formatPace(workout.average_speed).replace("/км", "")}
                      <small>/км</small>
                    </div>
                    <div className="run-metric num run-metric-opt">
                      {workout.average_heartrate ? Math.round(workout.average_heartrate) : "—"}
                      <small>пульс</small>
                    </div>
                    <span className={workout.has_feedback ? "status-tag" : "status-tag is-todo"}>
                      {workout.has_feedback ? "Прокомментирована" : "Ждёт комментария"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link to="/trainer/feed" className="panel-footer-link">
            Вся лента
          </Link>
        </section>

        <section className="panel split-side">
          <div className="panel-head">
            <h2 className="panel-title">Лидеры недели</h2>
            <span className="panel-hint">по километражу</span>
          </div>
          {leadersWithData.length === 0 ? (
            <p className="empty">На этой неделе пока никто не бегал. Лидеры появятся после первых пробежек.</p>
          ) : (
            <ol className="leader-list">
              {leadersWithData.map((athlete, index) => (
                <li key={athlete.id}>
                  <Link className="leader-row" to={`/trainer/athletes/${athlete.id}`}>
                    <span className={index === 0 ? "leader-place is-first" : "leader-place"}>{index + 1}</span>
                    <span className="leader-name">{athlete.full_name}</span>
                    <span className="leader-bar" aria-hidden="true">
                      <i style={{ width: `${(athlete.week_distance_meters / leaderMax) * 100}%` }} />
                    </span>
                    <span className="leader-km num">{formatKm(athlete.week_distance_meters)} км</span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
