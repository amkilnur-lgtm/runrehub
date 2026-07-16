import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../api";
import { AthleteAccountHeader, type PeriodStats, type StatsPeriodKey } from "../components/AthleteAccountHeader";
import { AthleteFeed } from "../components/AthleteFeed";
import { AthleteTrends } from "../components/AthleteTrends";
import { useAuth } from "../components/AuthProvider";
import { EditableAvatarMenu } from "../components/EditableAvatarMenu";
import { useApi } from "../hooks/useApi";
import { formatDate, formatDistance, formatDuration, formatPace } from "../lib";

type AthleteTab = "feed" | "mine";

type AthleteDashboardData = {
  athlete: {
    id: number;
    full_name: string;
    username: string;
    avatar_url: string | null;
    connected_at: string | null;
    last_synced_at: string | null;
    provider?: "intervals" | null;
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
    average_heartrate: number | null;
  }>;
  nextCursor: {
    beforeDate: string;
    beforeId: number;
  } | null;
};

export function AthleteDashboardPage() {
  const { user } = useAuth();
  const { data, loading, error } = useApi<AthleteDashboardData>("/api/athlete/dashboard");
  const [extraWorkouts, setExtraWorkouts] = useState<AthleteDashboardData["workouts"]>([]);
  const [nextCursor, setNextCursor] = useState<AthleteDashboardData["nextCursor"]>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [selectedPeriod, setSelectedPeriod] = useState<StatsPeriodKey>("week");
  const [tab, setTab] = useState<AthleteTab>("feed");

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
        avatarControl={
          <EditableAvatarMenu
            fullName={user?.fullName ?? data.athlete.full_name}
            avatarUrl={user?.avatarUrl ?? data.athlete.avatar_url}
            className="athlete-account-avatar"
          />
        }
      />

      <div className="athlete-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "feed"}
          className={`athlete-tab${tab === "feed" ? " active" : ""}`}
          onClick={() => setTab("feed")}
        >
          Лента
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "mine"}
          className={`athlete-tab${tab === "mine" ? " active" : ""}`}
          onClick={() => setTab("mine")}
        >
          Мои тренировки
        </button>
      </div>

      {tab === "feed" ? (
        <>
          <div className="feed-head">
            <span className="muted trainer-dashboard-eyebrow">Лента команды</span>
          </div>
          <AthleteFeed />
        </>
      ) : (
        <>
          <AthleteTrends />

          <section className="card trainer-dashboard-list-section">
            <div className="trainer-dashboard-heading">
              <span className="muted trainer-dashboard-eyebrow">Пробежки</span>
            </div>
            {allWorkouts.length === 0 ? (
          <div className="trainer-dashboard-leader-empty">
            <strong>Пока нет тренировок.</strong>
            <div className="muted">
              {data.athlete.connected_at
                ? "Пробежки появятся автоматически после следующей синхронизации с часами."
                : "Попросите администратора подключить синхронизацию intervals.icu — тренировки будут подтягиваться с часов автоматически."}
            </div>
          </div>
        ) : (
          <div className="trainer-dashboard-workout-list">
            {allWorkouts.map((workout) => (
              <Link
                key={workout.id}
                className="trainer-dashboard-workout-row"
                to={`/athlete/workouts/${workout.id}`}
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
        </>
      )}
    </div>
  );
}
