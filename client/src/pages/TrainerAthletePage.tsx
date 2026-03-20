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

  return (
    <div className="card">
      <Link to="/trainer" className="inline-link">Назад</Link>
      <div className="athlete-overview-grid">
        <div className="athlete-profile-header">
          <UserAvatar
            fullName={data.athlete.full_name}
            avatarUrl={data.athlete.avatar_url}
            className="athlete-profile-avatar"
            ariaHidden
          />
          <div className="athlete-profile-title">
            <h2>{data.athlete.full_name}</h2>
            <p className="muted">@{data.athlete.username}</p>
          </div>
        </div>
        <section className="athlete-stats-card inset-card">
          <div className="athlete-stats-topbar">
            <div>
              <div className="eyebrow">Сводка</div>
              <strong className="athlete-stats-title">Статистика спортсмена</strong>
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
          <div className="athlete-stats-grid">
            <div className="athlete-stats-item">
              <span className="muted">Километраж</span>
              <strong>{formatDistance(selectedStats.distance_meters)}</strong>
            </div>
            <div className="athlete-stats-item">
              <span className="muted">Время</span>
              <strong>{formatStatsHours(selectedStats.moving_time_seconds)}</strong>
            </div>
            <div className="athlete-stats-item">
              <span className="muted">Набор высоты</span>
              <strong>{formatStatsElevation(selectedStats.elevation_gain)}</strong>
            </div>
            <div className="athlete-stats-item">
              <span className="muted">Тренировки</span>
              <strong>{selectedStats.workout_count}</strong>
            </div>
          </div>
          <p className="muted athlete-stats-caption">
            Периодическая сводка считается по завершённым тренировкам спортсмена.
          </p>
        </section>
      </div>
      
      <h3>Все пробежки</h3>
      <div className="list">
        {allWorkouts.length === 0 && <div className="muted">Пока нет тренировок.</div>}
        {allWorkouts.map((workout) => (
          <Link key={workout.id} className="list-row link-row" to={`/trainer/workouts/${workout.id}`}>
            <div>
              <strong>{workout.name}</strong>
              <div className="muted">{formatDate(workout.start_date)}</div>
            </div>
            <div className="align-right">
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
    </div>
  );
}
