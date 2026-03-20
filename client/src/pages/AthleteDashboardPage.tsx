import { useState, useEffect } from "react";
import { Link } from "react-router-dom";

import { api } from "../api";
import { useApi } from "../hooks/useApi";
import { formatDate, formatDistance, formatPace, formatDuration } from "../lib";
import { StatCard } from "../components/StatCard";

type AthleteDashboardData = {
  athlete: {
    id: number;
    full_name: string;
    username: string;
    connected_at: string | null;
    last_synced_at: string | null;
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
  const [extraWorkouts, setExtraWorkouts] = useState<AthleteDashboardData['workouts']>([]);
  const [nextCursor, setNextCursor] = useState<AthleteDashboardData["nextCursor"]>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  // Сброс при полном рефреше данных
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

  async function sync() {
    await api("/api/athlete/strava/sync", { method: "POST" });
    refresh();
  }

  async function disconnectStrava() {
    if (!window.confirm("Вы уверены, что хотите отключить Strava? Ваша история тренировок останется, но новые не будут загружаться.")) return;
    await api("/api/athlete/strava/disconnect", { method: "DELETE" });
    refresh();
  }

  if (loading) {
    return (
      <div className="stack">
        <section className="card skeleton-card">
          <div className="section-header">
            <div>
              <h2>Загрузка...</h2>
              <p className="muted">Подождите, мы получаем ваши данные</p>
            </div>
          </div>
          <div className="grid three-columns">
            <StatCard label="Страва" value="Загрузка..." />
            <StatCard label="Последняя синхронизация" value="Загрузка..." />
            <StatCard label="Последняя тренировка" value="Загрузка..." />
          </div>
        </section>
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
  const latest = allWorkouts[0];

  return (
    <div className="stack">
      <section className="card">
        <div className="section-header">
          <div>
            <h2>{data.athlete.full_name ?? "Спортсмен"}</h2>
            <p className="muted">
              Новые тренировки подтягиваются webhook-ом и фоновым sync каждые 15 минут.
            </p>
          </div>
          <div className="topbar-actions">
            {data.athlete.connected_at ? (
              <div style={{ display: "flex", gap: "8px" }}>
                <button className="ghost-button" onClick={sync}>
                  Обновить
                </button>
                <button className="ghost-button" style={{ color: "red" }} onClick={disconnectStrava}>
                  Отключить
                </button>
              </div>
            ) : (
              <button className="primary-button" onClick={connectStrava}>
                Подключить Strava
              </button>
            )}
          </div>
        </div>
        <div className="grid three-columns">
          <StatCard
            label="Страва"
            value={data.athlete.connected_at ? "Подключена" : "Не подключена"}
          />
          <StatCard
            label="Последняя синхронизация"
            value={
              data.athlete.last_synced_at
                ? formatDate(data.athlete.last_synced_at)
                : "Еще не было"
            }
          />
          <StatCard
            label="Последняя тренировка"
            value={latest ? formatDate(latest.start_date) : "Нет данных"}
          />
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
