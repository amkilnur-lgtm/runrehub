import { Link, useParams } from "react-router-dom";
import { useState, useEffect } from "react";

import { api } from "../api";
import { UserAvatar } from "../components/UserAvatar";
import { formatDate, formatDistance, formatDuration, formatPace } from "../lib";
import { useApi } from "../hooks/useApi";

type StatsPeriodKey = "week" | "year" | "allTime";

type PeriodStats = {
  distance_meters: number;
  moving_time_seconds: number;
  elevation_gain: number;
  workout_count: number;
};

type AthletePageData = {
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

function formatSyncStatus(
  connectedAt: string | null,
  lastSyncedAt: string | null
) {
  if (!connectedAt) {
    return {
      title: "Strava не подключена",
      subtitle: null
    };
  }

  return {
    title: "Strava подключена",
    subtitle: lastSyncedAt
      ? `Последняя синхронизация: ${formatDate(lastSyncedAt)}`
      : "Последняя синхронизация: ещё не выполнялась"
  };
}

export function TrainerAthletePage() {
  const params = useParams();
  const { data, loading, error } = useApi<AthletePageData>(`/api/trainer/athletes/${params.id}`);

  const [extraWorkouts, setExtraWorkouts] = useState<AthletePageData['workouts']>([]);
  const [nextCursor, setNextCursor] = useState<AthletePageData["nextCursor"]>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [selectedPeriod, setSelectedPeriod] = useState<StatsPeriodKey>("week");

  useEffect(() => {
    if (data) {
      setExtraWorkouts([]);
      setNextCursor(data.nextCursor);
      setHasMore(Boolean(data.nextCursor));
    }
  }, [data]);

  async function loadMore() {
    if (!nextCursor) return;

    setIsLoadingMore(true);
    try {
      const search = new URLSearchParams({
        beforeDate: nextCursor.beforeDate,
        beforeId: String(nextCursor.beforeId)
      });
      const moreData = await api<AthletePageData>(
        `/api/trainer/athletes/${params.id}?${search.toString()}`
      );
      setExtraWorkouts((prev) => [...prev, ...moreData.workouts]);
      setNextCursor(moreData.nextCursor);
      setHasMore(Boolean(moreData.nextCursor));
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingMore(false);
    }
  }

  if (loading) {
    return (
      <div className="card skeleton-card">
        <h2>Загрузка профиля спортсмена...</h2>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="card">
        <h2>Ошибка</h2>
        <p className="muted">{error || "Спортсмен не найден"}</p>
        <Link to="/trainer" className="button primary-button">Назад</Link>
      </div>
    );
  }

  const allWorkouts = [...data.workouts, ...extraWorkouts];
  const selectedStats = data.stats[selectedPeriod];
  const syncStatus = formatSyncStatus(
    data.athlete.connected_at,
    data.athlete.last_synced_at
  );

  return (
    <div className="stack">
      <section className="athlete-account-header">
        <Link to="/trainer" className="inline-link">Назад</Link>
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
                <div>{syncStatus.title}</div>
                {syncStatus.subtitle ? (
                  <div className="muted">{syncStatus.subtitle}</div>
                ) : null}
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
              Периодическая сводка считается по завершённым тренировкам спортсмена.
            </p>
          </div>
        </div>
      </section>

      <section className="card">
        <h3>Все пробежки</h3>
        <div className="list">
          {allWorkouts.length === 0 && <div className="muted">Пока нет тренировок.</div>}
          {allWorkouts.map((workout) => (
            <Link
              key={workout.id}
              className="list-row link-row compact-workout-row"
              to={`/trainer/workouts/${workout.id}`}
            >
              <div className="compact-workout-main">
                <strong>{workout.name}</strong>
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
        {allWorkouts.length > 0 && hasMore && (
           <div style={{ marginTop: "16px", textAlign: "center" }}>
             <button className="ghost-button" disabled={isLoadingMore} onClick={loadMore}>
               {isLoadingMore ? "Загрузка..." : "Загрузить ещё"}
             </button>
           </div>
        )}
      </section>
    </div>
  );
}
