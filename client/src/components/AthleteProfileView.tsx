import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../api";
import { useApi } from "../hooks/useApi";
import { formatAgo, formatDuration, formatKm, formatPace } from "../lib";
import { AthleteFeed } from "./AthleteFeed";
import { AthleteTrends } from "./AthleteTrends";
import { UserAvatar } from "./UserAvatar";

export type StatsPeriodKey = "week" | "month" | "year" | "allTime";

export type PeriodStats = {
  distance_meters: number;
  moving_time_seconds: number;
  elevation_gain: number;
  workout_count: number;
};

type ProfileWorkout = {
  id: number;
  name: string;
  start_date: string;
  distance_meters: number;
  moving_time_seconds: number;
  average_speed: number | null;
};

type ProfileData = {
  athlete: {
    id: number;
    full_name: string;
    username: string;
    avatar_url: string | null;
    connected_at: string | null;
    last_synced_at: string | null;
  };
  stats: Record<StatsPeriodKey, PeriodStats>;
  workouts: ProfileWorkout[];
  nextCursor: { beforeDate: string; beforeId: number } | null;
};

const PERIODS: Array<{ key: StatsPeriodKey; label: string; phrase: string }> = [
  { key: "week", label: "Неделя", phrase: "на этой неделе" },
  { key: "month", label: "Месяц", phrase: "в этом месяце" },
  { key: "year", label: "Год", phrase: "в этом году" },
  { key: "allTime", label: "Всё", phrase: "за всё время" }
];

function hoursMinutes(seconds: number) {
  return { hours: Math.floor(seconds / 3600), minutes: Math.floor((seconds % 3600) / 60) };
}

function syncLabel(connectedAt: string | null, lastSyncedAt: string | null) {
  if (!connectedAt) return { ok: false, text: "Синхронизация не подключена" };
  return { ok: true, text: lastSyncedAt ? `intervals.icu · обновлено ${formatAgo(lastSyncedAt)}` : "intervals.icu подключён" };
}

type AthleteProfileViewProps = {
  endpoint: string;
  backTo: string;
  backLabel: string;
  workoutHref: (id: number) => string;
  trends: { athleteId?: number; trendsEndpoint?: string };
  emptyHint: (connected: boolean) => string;
  // тренеру важен статус синхронизации, одногруппнику — когда человек бегал
  viewer: "trainer" | "teammate";
};

export function AthleteProfileView({ endpoint, backTo, backLabel, workoutHref, trends, emptyHint, viewer }: AthleteProfileViewProps) {
  const { data, loading, error } = useApi<ProfileData>(endpoint);
  const [extra, setExtra] = useState<ProfileWorkout[]>([]);
  const [nextCursor, setNextCursor] = useState<ProfileData["nextCursor"]>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [period, setPeriod] = useState<StatsPeriodKey>("week");

  useEffect(() => {
    if (data) {
      setExtra([]);
      setNextCursor(data.nextCursor);
    }
  }, [data]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const search = new URLSearchParams({ beforeDate: nextCursor.beforeDate, beforeId: String(nextCursor.beforeId) });
      const more = await api<ProfileData>(`${endpoint}?${search.toString()}`);
      setExtra((prev) => [...prev, ...more.workouts]);
      setNextCursor(more.nextCursor);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingMore(false);
    }
  }

  if (loading) {
    return (
      <div className="page-stack">
        <div className="skeleton-block" style={{ height: 220 }} />
        <div className="skeleton-block" style={{ height: 380 }} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <section className="panel panel-pad">
        <h2 className="panel-title">Спортсмен не найден</h2>
        <p className="muted">{error || "Возможно, он больше не в вашей группе."}</p>
        <Link to={backTo} className="back-link">
          ← {backLabel}
        </Link>
      </section>
    );
  }

  const stats = data.stats[period];
  const info = PERIODS.find((item) => item.key === period)!;
  const time = hoursMinutes(stats.moving_time_seconds);
  const sync = syncLabel(data.athlete.connected_at, data.athlete.last_synced_at);
  const workouts = [...data.workouts, ...extra];

  return (
    <div className="page-stack">
      <Link to={backTo} className="back-link">
        ← {backLabel}
      </Link>

      <section className="panel profile-head">
        <div className="profile-identity">
          <UserAvatar fullName={data.athlete.full_name} avatarUrl={data.athlete.avatar_url} className="avatar-lg" ariaHidden />
          <div className="profile-name">
            <h1 className="page-title">{data.athlete.full_name}</h1>
            <p className="page-subtitle profile-subtitle">
              {viewer === "trainer" ? (
                <>
                  @{data.athlete.username} · <span className={sync.ok ? "sync-ok" : "sync-off"}>{sync.text}</span>
                </>
              ) : data.workouts[0] ? (
                <>последняя пробежка {formatAgo(data.workouts[0].start_date)}</>
              ) : (
                <>@{data.athlete.username}</>
              )}
            </p>
          </div>
          <div className="segmented profile-periods" role="tablist" aria-label="Период">
            {PERIODS.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={item.key === period}
                className={item.key === period ? "segmented-item is-active" : "segmented-item"}
                onClick={() => setPeriod(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="kpi-strip kpi-strip-inner" aria-label={`Статистика ${info.phrase}`}>
          <div className="kpi">
            <div className="kpi-label">Километраж</div>
            <div className="kpi-value num">
              {formatKm(stats.distance_meters)}
              <small>км</small>
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Время в беге</div>
            <div className="kpi-value num">
              {time.hours}
              <small>ч</small> {time.minutes}
              <small>м</small>
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Набор высоты</div>
            <div className="kpi-value num">
              {Math.round(stats.elevation_gain)}
              <small>м</small>
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Тренировок</div>
            <div className="kpi-value num">{stats.workout_count}</div>
          </div>
        </div>
      </section>

      <AthleteTrends {...trends} volumeOnly={viewer === "teammate"} />

      {viewer === "teammate" ? (
        <>
          <h2 className="section-title">Пробежки</h2>
          <AthleteFeed endpoint={`${endpoint}/feed`} emptyText="Пока нет пробежек." />
        </>
      ) : (
      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Пробежки</h2>
          <span className="panel-hint">сначала новые</span>
        </div>
        {workouts.length === 0 ? (
          <p className="empty">{emptyHint(Boolean(data.athlete.connected_at))}</p>
        ) : (
          <ul className="run-list">
            {workouts.map((workout) => (
              <li key={workout.id}>
                <Link className="run-row run-row-profile" to={workoutHref(workout.id)}>
                  <div className="run-row-main">
                    <strong>{workout.name}</strong>
                    <span>{formatAgo(workout.start_date)}</span>
                  </div>
                  <div className="run-metric num">
                    {formatKm(workout.distance_meters)}
                    <small>км</small>
                  </div>
                  <div className="run-metric num run-metric-opt">
                    {formatDuration(workout.moving_time_seconds)}
                    <small>время</small>
                  </div>
                  <div className="run-metric num">
                    {formatPace(workout.average_speed).replace("/км", "")}
                    <small>/км</small>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {nextCursor && workouts.length ? (
          <button type="button" className="panel-footer-link" disabled={loadingMore} onClick={loadMore}>
            {loadingMore ? "Загружаем…" : "Показать ещё"}
          </button>
        ) : null}
      </section>
      )}
    </div>
  );
}
