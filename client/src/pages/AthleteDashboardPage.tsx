import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../api";
import { UserAvatar } from "../components/UserAvatar";
import { useApi } from "../hooks/useApi";
import { formatDate, formatDistance, formatDuration, formatPace } from "../lib";

type StatsPeriodKey = "week" | "year" | "allTime";

type PeriodStats = {
  distance_meters: number;
  moving_time_seconds: number;
  elevation_gain: number;
  workout_count: number;
};

type AthleteDashboardData = {
  athlete: {
    id: number;
    full_name: string;
    username: string;
    avatar_url: string | null;
    connected_at: string | null;
    last_synced_at: string | null;
  };
  stats: {
    week: PeriodStats;
    year: PeriodStats;
    allTime: PeriodStats;
  };
  workouts: Array<{
    id: number;
    name: string;
    start_date: string;
    distance_meters: number;
    moving_time_seconds: number;
    average_speed: number | null;
    average_heartrate: number | null;
  }>;
  nextCursor: {
    beforeDate: string;
    beforeId: number;
  } | null;
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

function formatStatsElevation(value: number) {
  return `${Math.round(value)} м`;
}

function formatSyncStatus(connectedAt: string | null, lastSyncedAt: string | null) {
  if (!connectedAt) {
    return {
      title: "Strava не подключена",
      subtitle: "Подключите Strava для автоматической синхронизации"
    };
  }

  return {
    title: "Strava подключена",
    subtitle: lastSyncedAt
      ? `Последняя синхронизация: ${formatDate(lastSyncedAt)}`
      : "Последняя синхронизация: еще не выполнялась"
  };
}

export function AthleteDashboardPage() {
  const { data, loading, error, refresh } = useApi<AthleteDashboardData>("/api/athlete/dashboard");
  const [extraWorkouts, setExtraWorkouts] = useState<AthleteDashboardData["workouts"]>([]);
  const [nextCursor, setNextCursor] = useState<AthleteDashboardData["nextCursor"]>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [selectedPeriod, setSelectedPeriod] = useState<StatsPeriodKey>("week");
  const [isStravaMenuOpen, setIsStravaMenuOpen] = useState(false);
  const stravaMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (data) {
      setExtraWorkouts([]);
      setNextCursor(data.nextCursor);
      setHasMore(Boolean(data.nextCursor));
    }
  }, [data]);

  useEffect(() => {
    if (!isStravaMenuOpen) {
      return undefined;
    }

    function handlePointerDown(event: MouseEvent) {
      if (stravaMenuRef.current && !stravaMenuRef.current.contains(event.target as Node)) {
        setIsStravaMenuOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsStravaMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isStravaMenuOpen]);

  async function loadMore() {
    if (!nextCursor) {
      return;
    }

    setIsLoadingMore(true);
    try {
      const search = new URLSearchParams({
        beforeDate: nextCursor.beforeDate,
        beforeId: String(nextCursor.beforeId)
      });
      const moreData = await api<AthleteDashboardData>(`/api/athlete/dashboard?${search.toString()}`);
      setExtraWorkouts((prev) => [...prev, ...moreData.workouts]);
      setNextCursor(moreData.nextCursor);
      setHasMore(Boolean(moreData.nextCursor));
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingMore(false);
    }
  }

  async function connectStrava() {
    const response = await api<{ url: string }>("/api/athlete/strava/connect");
    window.location.href = response.url;
  }

  async function disconnectStrava() {
    const confirmed = window.confirm(
      "Вы уверены, что хотите отключить Strava? История тренировок останется, но новые данные больше не будут подтягиваться автоматически."
    );
    if (!confirmed) {
      return;
    }

    await api("/api/athlete/strava/disconnect", { method: "DELETE" });
    setIsStravaMenuOpen(false);
    refresh();
  }

  if (loading) {
    return (
      <div className="stack">
        <section className="athlete-account-header skeleton-card" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="stack">
        <section className="card">
          <h2>Ошибка</h2>
          <p className="muted">{error || "Ошибка загрузки данных"}</p>
        </section>
      </div>
    );
  }

  const allWorkouts = [...data.workouts, ...extraWorkouts];
  const selectedStats = data.stats[selectedPeriod];
  const syncStatus = formatSyncStatus(data.athlete.connected_at, data.athlete.last_synced_at);

  return (
    <div className="stack">
      <section className="athlete-account-header">
        <div className="athlete-account-header-grid">
          <div className="athlete-account-identity">
            <UserAvatar
              fullName={data.athlete.full_name}
              avatarUrl={data.athlete.avatar_url}
              className="athlete-account-avatar"
              ariaHidden
            />
            <div className="athlete-account-title">
              <h1>{data.athlete.full_name}</h1>
              <p className="muted">@{data.athlete.username}</p>
            </div>
          </div>
          <div className="athlete-account-main">
            <div className="athlete-account-topbar">
              <div className="athlete-account-status">
                {data.athlete.connected_at ? (
                  <div className="athlete-strava-control" ref={stravaMenuRef}>
                    <button
                      type="button"
                      className="athlete-account-status-trigger"
                      aria-expanded={isStravaMenuOpen}
                      onClick={() => setIsStravaMenuOpen((open) => !open)}
                    >
                      {syncStatus.title}
                    </button>
                    {syncStatus.subtitle ? <div className="muted">{syncStatus.subtitle}</div> : null}
                    {isStravaMenuOpen ? (
                      <div className="athlete-strava-popover">
                        <button
                          type="button"
                          className="athlete-strava-item athlete-strava-item-danger"
                          onClick={disconnectStrava}
                        >
                          Отключить
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <>
                    <button type="button" className="primary-button athlete-strava-button" onClick={connectStrava}>
                      Подключить Strava
                    </button>
                    {syncStatus.subtitle ? <div className="muted">{syncStatus.subtitle}</div> : null}
                  </>
                )}
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
            <div className="athlete-account-stats">
              <div className="athlete-account-stat">
                <span className="muted">Километраж</span>
                <strong>{formatDistance(selectedStats.distance_meters)}</strong>
              </div>
              <div className="athlete-account-stat">
                <span className="muted">Время</span>
                <strong>{formatStatsHours(selectedStats.moving_time_seconds)}</strong>
              </div>
              <div className="athlete-account-stat">
                <span className="muted">Набор высоты</span>
                <strong>{formatStatsElevation(selectedStats.elevation_gain)}</strong>
              </div>
              <div className="athlete-account-stat">
                <span className="muted">Тренировки</span>
                <strong>{selectedStats.workout_count}</strong>
              </div>
            </div>
            <p className="muted athlete-account-caption">
              Периодическая сводка считается по завершенным тренировкам спортсмена.
            </p>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>История тренировок</h2>
        <div className="list">
          {allWorkouts.length === 0 && <div className="muted">Пока нет тренировок.</div>}
          {allWorkouts.map((workout) => (
            <Link key={workout.id} className="list-row link-row dashboard-workout-row" to={`/athlete/workouts/${workout.id}`}>
              <div className="dashboard-workout-main">
                <strong>{workout.name}</strong>
                <div className="muted dashboard-workout-date">{formatDate(workout.start_date)}</div>
              </div>
              <div className="align-right dashboard-workout-meta">
                <div className="dashboard-workout-distance">{formatDistance(workout.distance_meters)}</div>
                <div className="muted dashboard-workout-summary">
                  {formatDuration(workout.moving_time_seconds)} · {formatPace(workout.average_speed)}
                </div>
              </div>
            </Link>
          ))}
        </div>
        {allWorkouts.length > 0 && hasMore ? (
          <div style={{ marginTop: "16px", textAlign: "center" }}>
            <button className="ghost-button" disabled={isLoadingMore} onClick={loadMore}>
              {isLoadingMore ? "Загрузка..." : "Загрузить ещё"}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
