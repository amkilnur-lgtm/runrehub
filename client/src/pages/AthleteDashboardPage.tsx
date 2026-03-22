import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../api";
import { AthleteAccountHeader, type PeriodStats, type StatsPeriodKey } from "../components/AthleteAccountHeader";
import { useApi } from "../hooks/useApi";
import { formatDate, formatDistance, formatDuration, formatPace } from "../lib";

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

export function AthleteDashboardPage() {
  const { data, loading, error, refresh } = useApi<AthleteDashboardData>("/api/athlete/dashboard");
  const [extraWorkouts, setExtraWorkouts] = useState<AthleteDashboardData["workouts"]>([]);
  const [nextCursor, setNextCursor] = useState<AthleteDashboardData["nextCursor"]>(null);
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

  return (
    <div className="stack">
      <AthleteAccountHeader
        athlete={data.athlete}
        stats={data.stats}
        selectedPeriod={selectedPeriod}
        onPeriodChange={setSelectedPeriod}
        onConnectStrava={connectStrava}
        onDisconnectStrava={disconnectStrava}
      />

      <section className="card">
        <h2>История тренировок</h2>
        <div className="list">
          {allWorkouts.length === 0 ? <div className="muted">Пока нет тренировок.</div> : null}
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
