import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { api } from "../api";
import { AthleteAccountHeader, type PeriodStats, type StatsPeriodKey } from "../components/AthleteAccountHeader";
import { useApi } from "../hooks/useApi";
import { formatDate, formatDistance, formatDuration, formatPace } from "../lib";

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
    month: PeriodStats;
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

export function TrainerAthletePage() {
  const params = useParams();
  const { data, loading, error } = useApi<AthletePageData>(`/api/trainer/athletes/${params.id}`);

  const [extraWorkouts, setExtraWorkouts] = useState<AthletePageData["workouts"]>([]);
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
    if (!nextCursor) {
      return;
    }

    setIsLoadingMore(true);
    try {
      const search = new URLSearchParams({
        beforeDate: nextCursor.beforeDate,
        beforeId: String(nextCursor.beforeId)
      });
      const moreData = await api<AthletePageData>(`/api/trainer/athletes/${params.id}?${search.toString()}`);
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

  return (
    <div className="stack">
      <section className="athlete-account-header-shell">
        <Link to="/trainer" className="inline-link">Назад</Link>
        <AthleteAccountHeader
          athlete={data.athlete}
          stats={data.stats}
          selectedPeriod={selectedPeriod}
          onPeriodChange={setSelectedPeriod}
        />
      </section>

      <section className="card trainer-dashboard-list-section">
        <div className="trainer-dashboard-heading">
          <span className="muted trainer-dashboard-eyebrow">Пробежки</span>
        </div>
        {allWorkouts.length === 0 ? (
          <div className="trainer-dashboard-leader-empty">
            <strong>Пока нет тренировок.</strong>
          </div>
        ) : (
          <div className="trainer-dashboard-workout-list">
            {allWorkouts.map((workout) => (
              <Link
                key={workout.id}
                className="trainer-dashboard-workout-row"
                to={`/trainer/workouts/${workout.id}`}
              >
                <div className="trainer-dashboard-workout-main">
                  <strong>{workout.name}</strong>
                  <div className="muted">{formatDate(workout.start_date)}</div>
                </div>
                <div className="trainer-dashboard-workout-meta">
                  <div>{formatDistance(workout.distance_meters)}</div>
                  <div className="muted">
                    {formatDuration(workout.moving_time_seconds)} · {formatPace(workout.average_speed)}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
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
