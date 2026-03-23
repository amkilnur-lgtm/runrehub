import { useState } from "react";
import { Link } from "react-router-dom";

import { UserAvatar } from "../components/UserAvatar";
import { useAuth } from "../components/AuthProvider";
import { useApi } from "../hooks/useApi";
import { formatDate, formatDistance, formatDuration, formatPace } from "../lib";

type StatsPeriodKey = "week" | "year" | "allTime";

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
    name: string;
    start_date: string;
    distance_meters: number;
    moving_time_seconds: number;
    average_speed: number | null;
  }>;
  connectedAthletesCount: number;
  stats: {
    week: GroupPeriodStats;
    year: GroupPeriodStats;
    allTime: GroupPeriodStats;
  };
  topAthletesThisWeek: Array<{
    id: number;
    full_name: string;
    username: string;
    avatar_url: string | null;
    week_distance_meters: number;
    week_workout_count: number;
  }>;
};

const statsPeriods: Array<{ key: StatsPeriodKey; label: string }> = [
  { key: "week", label: "Неделя" },
  { key: "year", label: "Год" },
  { key: "allTime", label: "Все время" }
];

function formatStatsHours(seconds: number) {
  if (seconds <= 0) {
    return "0ч 0м";
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}ч ${minutes}м`;
}

function formatSummaryCaption(periodLabel: string, stats: GroupPeriodStats) {
  if (stats.workout_count === 0) {
    return `За ${periodLabel.toLowerCase()} пока нет завершенных тренировок по группе.`;
  }

  return `${stats.active_athlete_count} из ${stats.athlete_count} спортсменов были активны за ${periodLabel.toLowerCase()}.`;
}

export function TrainerDashboardPage() {
  const { user } = useAuth();
  const { data, loading, error } = useApi<DashboardData>("/api/trainer/dashboard");
  const [selectedPeriod, setSelectedPeriod] = useState<StatsPeriodKey>("week");

  if (loading) {
    return (
      <div className="stack">
        <section className="trainer-dashboard-header skeleton-card" />
        <div className="grid two-columns">
          <section className="card skeleton-card">
            <h2>Спортсмены</h2>
            <p className="muted">Загрузка...</p>
          </section>
          <section className="card skeleton-card">
            <h2>Последние пробежки</h2>
            <p className="muted">Загрузка...</p>
          </section>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="card">
        <h2>Ошибка</h2>
        <p className="muted">{error || "Не удалось загрузить данные"}</p>
      </div>
    );
  }

  const selectedStats = data.stats[selectedPeriod];
  const selectedPeriodLabel = statsPeriods.find((period) => period.key === selectedPeriod)?.label ?? "Период";
  const hasLeaderData = data.topAthletesThisWeek.some((athlete) => athlete.week_distance_meters > 0 || athlete.week_workout_count > 0);

  return (
    <div className="stack">
      <section className="trainer-dashboard-header">
        <div className="trainer-dashboard-grid">
          <div className="trainer-dashboard-panel trainer-dashboard-identity">
            <div className="trainer-dashboard-identity-main">
              <UserAvatar
                fullName={user?.fullName}
                avatarUrl={user?.avatarUrl}
                className="trainer-dashboard-avatar"
                ariaHidden
              />
              <div className="trainer-dashboard-title">
                <h2>{user?.fullName}</h2>
                <p className="muted">@{user?.username}</p>
              </div>
            </div>
            <div className="trainer-dashboard-meta">
              <div>{data.athletes.length} спортсменов</div>
              <div className="muted">{data.connectedAthletesCount} подключили Strava</div>
            </div>
          </div>

          <div className="trainer-dashboard-panel trainer-dashboard-summary">
            <div className="trainer-dashboard-summary-topbar">
              <div className="trainer-dashboard-heading">
                <span className="muted trainer-dashboard-eyebrow">Сводка</span>
                <h2>Статистика по спортсменам</h2>
              </div>
              <div className="athlete-stats-periods" role="tablist" aria-label="Период статистики">
                {statsPeriods.map((period) => (
                  <button
                    key={period.key}
                    type="button"
                    className={
                      period.key === selectedPeriod
                        ? "athlete-stats-period is-active"
                        : "athlete-stats-period"
                    }
                    onClick={() => setSelectedPeriod(period.key)}
                  >
                    {period.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="trainer-dashboard-stats">
              <div className="trainer-dashboard-stat">
                <span className="muted">Активные</span>
                <strong>{selectedStats.active_athlete_count}</strong>
              </div>
              <div className="trainer-dashboard-stat">
                <span className="muted">Тренировки</span>
                <strong>{selectedStats.workout_count}</strong>
              </div>
              <div className="trainer-dashboard-stat">
                <span className="muted">Километраж</span>
                <strong>{formatDistance(selectedStats.distance_meters)}</strong>
              </div>
              <div className="trainer-dashboard-stat">
                <span className="muted">Время</span>
                <strong>{formatStatsHours(selectedStats.moving_time_seconds)}</strong>
              </div>
            </div>
            <p className="muted trainer-dashboard-caption">
              {formatSummaryCaption(selectedPeriodLabel, selectedStats)}
            </p>
          </div>

          <div className="trainer-dashboard-panel trainer-dashboard-leaders">
            <div className="trainer-dashboard-heading">
              <span className="muted trainer-dashboard-eyebrow">Лидеры</span>
              <h2>Топ-3 на неделе</h2>
            </div>
            {hasLeaderData ? (
              <div className="trainer-dashboard-leader-list">
                {data.topAthletesThisWeek.map((athlete, index) => (
                  <Link
                    key={athlete.id}
                    className="trainer-dashboard-leader-row"
                    to={`/trainer/athletes/${athlete.id}`}
                  >
                    <div className="trainer-dashboard-leader-rank">{index + 1}</div>
                    <UserAvatar
                      fullName={athlete.full_name}
                      avatarUrl={athlete.avatar_url}
                      className="trainer-dashboard-leader-avatar"
                      ariaHidden
                    />
                    <div className="trainer-dashboard-leader-text">
                      <strong>{athlete.full_name}</strong>
                      <div className="muted">{athlete.week_workout_count} тренировки</div>
                    </div>
                    <div className="trainer-dashboard-leader-distance">
                      {formatDistance(athlete.week_distance_meters)}
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="trainer-dashboard-leader-empty">
                <strong>На этой неделе пока нет завершенных тренировок.</strong>
                <div className="muted">Лидеры появятся, как только группа начнет набирать объем.</div>
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="grid two-columns">
        <section className="card">
          <h2>Спортсмены</h2>
          <div className="list">
            {data.athletes.map((athlete) => (
              <Link key={athlete.id} className="list-row link-row" to={`/trainer/athletes/${athlete.id}`}>
                <div className="athlete-list-main">
                  <UserAvatar
                    fullName={athlete.full_name}
                    avatarUrl={athlete.avatar_url}
                    className="athlete-list-avatar"
                    ariaHidden
                  />
                  <div className="athlete-list-text">
                    <strong>{athlete.full_name}</strong>
                    <div className="muted">@{athlete.username}</div>
                  </div>
                </div>
                <div className="muted">
                  {athlete.last_workout_at ? formatDate(athlete.last_workout_at) : "Без пробежек"}
                </div>
              </Link>
            ))}
          </div>
        </section>

        <section className="card">
          <h2>Последние пробежки</h2>
          <div className="list">
            {data.recentWorkouts.map((workout) => (
              <Link
                key={workout.id}
                className="list-row link-row compact-workout-row"
                to={`/trainer/workouts/${workout.id}`}
              >
                <div className="compact-workout-main">
                  <strong>{workout.athlete_name}</strong>
                  <div>{workout.name}</div>
                  <div className="muted">{formatDate(workout.start_date)}</div>
                </div>
                <div className="align-right compact-workout-meta">
                  <div>{formatDistance(workout.distance_meters)}</div>
                  <div className="muted">
                    {formatDuration(workout.moving_time_seconds)} · {formatPace(workout.average_speed)}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
