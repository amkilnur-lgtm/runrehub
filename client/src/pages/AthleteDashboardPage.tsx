import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../api";
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
};

export function AthleteDashboardPage() {
  const [data, setData] = useState<AthleteDashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const nextData = await api<AthleteDashboardData>("/api/athlete/dashboard");
    setData(nextData);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function connectStrava() {
    const response = await api<{ url: string }>("/api/athlete/strava/connect");
    window.location.href = response.url;
  }

  async function sync() {
    await api("/api/athlete/strava/sync", { method: "POST" });
    await load();
  }

  const latest = data?.workouts[0];

  return (
    <div className="stack">
      <section className="card">
        <div className="section-header">
          <div>
            <h2>{data?.athlete.full_name ?? "Спортсмен"}</h2>
            <p className="muted">
              Новые тренировки подтягиваются webhook-ом и фоновым sync каждые 15 минут.
            </p>
          </div>
          <div className="topbar-actions">
            {!loading && data?.athlete.connected_at ? (
              <button className="ghost-button" onClick={sync}>
                Обновить
              </button>
            ) : null}
            {!loading && !data?.athlete.connected_at ? (
              <button className="primary-button" onClick={connectStrava}>
                Подключить Strava
              </button>
            ) : null}
          </div>
        </div>
        <div className="grid three-columns">
          <StatCard
            label="Страва"
            value={loading ? "Проверяем..." : data?.athlete.connected_at ? "Подключена" : "Не подключена"}
          />
          <StatCard
            label="Последняя синхронизация"
            value={
              loading
                ? "Загрузка..."
                : data?.athlete.last_synced_at
                  ? formatDate(data.athlete.last_synced_at)
                  : "Еще не было"
            }
          />
          <StatCard
            label="Последняя тренировка"
            value={loading ? "Загрузка..." : latest ? formatDate(latest.start_date) : "Нет данных"}
          />
        </div>
      </section>

      <section className="card">
        <h2>Последние тренировки</h2>
        <div className="list">
          {!loading && !data?.workouts.length ? <div className="muted">Пока нет тренировок.</div> : null}
          {data?.workouts.map((workout) => (
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
      </section>
    </div>
  );
}
