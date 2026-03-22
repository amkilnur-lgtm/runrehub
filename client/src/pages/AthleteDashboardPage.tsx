import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";

import { api } from "../api";
import { useApi } from "../hooks/useApi";
import { formatDate, formatDistance, formatPace, formatDuration } from "../lib";
import { UserAvatar } from "../components/UserAvatar";

type AthleteDashboardData = {
  athlete: {
    id: number;
    full_name: string;
    username: string;
    avatar_url: string | null;
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
  const [isStravaMenuOpen, setIsStravaMenuOpen] = useState(false);
  const stravaMenuRef = useRef<HTMLDivElement | null>(null);

  // Сброс при полном рефреше данных
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
  const latest = allWorkouts[0];

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
              <h1>{data.athlete.full_name ?? "Спортсмен"}</h1>
              <p className="muted">@{data.athlete.username}</p>
            </div>
          </div>
          <div className="athlete-account-main">
            <div className="athlete-account-topbar">
              <div className="athlete-account-status">
                <div>{data.athlete.connected_at ? "Strava подключена" : "Strava не подключена"}</div>
                <div className="muted">
                  {data.athlete.connected_at
                    ? data.athlete.last_synced_at
                      ? `Последняя синхронизация: ${formatDate(data.athlete.last_synced_at)}`
                      : "Последняя синхронизация: ещё не выполнялась"
                    : "Подключите Strava для автоматической синхронизации"}
                </div>
              </div>
              <div className="athlete-strava-control" ref={stravaMenuRef}>
                {data.athlete.connected_at ? (
                  <>
                    <button
                      type="button"
                      className="ghost-button athlete-strava-button"
                      aria-expanded={isStravaMenuOpen}
                      onClick={() => setIsStravaMenuOpen((open) => !open)}
                    >
                      Strava подключена
                    </button>
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
                  </>
                ) : (
                  <button className="primary-button athlete-strava-button" onClick={connectStrava}>
                    Подключить Strava
                  </button>
                )}
              </div>
            </div>
            <div className="athlete-account-stats">
              <div className="athlete-account-stat">
                <span className="muted">Страва</span>
                <strong>{data.athlete.connected_at ? "Подключена" : "Не подключена"}</strong>
              </div>
              <div className="athlete-account-stat">
                <span className="muted">Последняя синхронизация</span>
                <strong>
                  {data.athlete.last_synced_at
                    ? formatDate(data.athlete.last_synced_at)
                    : "Еще не было"}
                </strong>
              </div>
              <div className="athlete-account-stat">
                <span className="muted">Последняя тренировка</span>
                <strong>{latest ? formatDate(latest.start_date) : "Нет данных"}</strong>
              </div>
            </div>
            <p className="muted athlete-account-caption">
              Новые тренировки подтягиваются webhook-ом и фоновым sync каждые 15 минут.
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
