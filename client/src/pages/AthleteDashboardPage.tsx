import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../api";
import { AthleteTrends } from "../components/AthleteTrends";
import { useAuth } from "../components/AuthProvider";
import { ResultForm, ResultsPanel, type ResultDraft } from "../components/Results";
import { RouteStaticMap } from "../components/RouteStaticMap";
import { ShareStoryButton } from "../components/ShareStoryButton";
import { UserAvatar } from "../components/UserAvatar";
import { useApi } from "../hooks/useApi";
import { formatAgo, formatDuration, formatKm, formatPace, pluralRu } from "../lib";

type AthleteTab = "runs" | "results";

type PeriodStats = {
  distance_meters: number;
  moving_time_seconds: number;
  elevation_gain: number;
  workout_count: number;
};

type WorkoutRow = {
  id: number;
  name: string;
  start_date: string;
  distance_meters: number;
  moving_time_seconds: number;
  average_speed: number | null;
  average_heartrate: number | null;
};

type Highlights = {
  weekStarts: string[];
  weeklyDistances: number[];
  streakWeeks: number;
  latestWorkout:
    | (WorkoutRow & {
        route: [number, number][] | null;
        coach_note: string | null;
        coach_name: string | null;
        coach_avatar_url: string | null;
        race_hint: { distanceMeters: number; label: string } | null;
      })
    | null;
};

type AthleteDashboardData = {
  athlete: {
    id: number;
    full_name: string;
    connected_at: string | null;
  };
  highlights: Highlights | null;
  stats: Record<"week" | "month" | "year" | "allTime", PeriodStats>;
  workouts: WorkoutRow[];
  nextCursor: { beforeDate: string; beforeId: number } | null;
};

const STREAK_DOTS_MAX = 10;

const SHORT_MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function weekRangeLabel(weekStartIso: string | undefined) {
  if (!weekStartIso) return "";
  const start = new Date(weekStartIso);
  const end = new Date(start.getTime() + 6 * 86_400_000);
  return start.getMonth() === end.getMonth()
    ? `${start.getDate()}–${end.getDate()} ${SHORT_MONTHS[end.getMonth()]}`
    : `${start.getDate()} ${SHORT_MONTHS[start.getMonth()]} – ${end.getDate()} ${SHORT_MONTHS[end.getMonth()]}`;
}

function shortDate(iso: string | undefined) {
  if (!iso) return "";
  const date = new Date(iso);
  return `${date.getDate()} ${SHORT_MONTHS[date.getMonth()]}`;
}

function hoursMinutes(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours} ч ${minutes} м` : `${minutes} м`;
}

function WeekHero({ highlights, week }: { highlights: Highlights; week: PeriodStats }) {
  const distances = highlights.weeklyDistances;
  const finished = distances.slice(0, -1).slice(-4).filter((meters) => meters > 0);
  const usual = finished.length ? finished.reduce((sum, value) => sum + value, 0) / finished.length : 0;
  const max = Math.max(...distances, 1);
  const lastIndex = distances.length - 1;
  const lastWeek = distances[lastIndex - 1] ?? 0;

  return (
    <section className="week-hero" aria-label="Эта неделя">
      <div className="week-hero-top">
        <span>Эта неделя · {weekRangeLabel(highlights.weekStarts[lastIndex])}</span>
        {week.workout_count > 0 ? (
          <span>
            {week.workout_count} {pluralRu(week.workout_count, "пробежка", "пробежки", "пробежек")}
          </span>
        ) : null}
      </div>
      <div className="week-hero-value num">
        {formatKm(week.distance_meters)}
        <small>км</small>
      </div>
      <div className="week-hero-meta">
        {week.workout_count === 0
          ? `Неделя только началась${lastWeek > 0 ? ` · на прошлой\u00a0— ${formatKm(lastWeek)}\u00a0км` : ""}`
          : `${hoursMinutes(week.moving_time_seconds)} в беге${usual > 0 ? ` · обычно ${formatKm(usual)}\u00a0км в\u00a0неделю` : ""}`}
      </div>
      <div className="week-bars" role="img" aria-label={`Километраж за ${distances.length} недель, текущая неделя выделена`}>
        {distances.map((meters, index) => (
          <i
            key={highlights.weekStarts[index] ?? index}
            className={index === lastIndex ? "is-current" : undefined}
            style={{ height: `${Math.max((meters / max) * 100, 4)}%` }}
            title={`${formatKm(meters)} км`}
          />
        ))}
      </div>
      <div className="week-bars-axis">
        <span>{shortDate(highlights.weekStarts[0])}</span>
        <span>эта неделя</span>
      </div>
    </section>
  );
}

function Streak({ weeks }: { weeks: number }) {
  if (weeks === 0) {
    return (
      <div className="streak-card">
        <div className="streak-dots" aria-hidden="true">
          <i className="is-off" />
        </div>
        <div>
          <strong>Начните серию</strong>
          <span>Одна пробежка на этой неделе — и пойдёт счёт недель подряд</span>
        </div>
      </div>
    );
  }
  return (
    <div className="streak-card">
      <div className="streak-dots" aria-hidden="true">
        {Array.from({ length: Math.min(weeks, STREAK_DOTS_MAX) }, (_, index) => (
          <i key={index} />
        ))}
      </div>
      <div>
        <strong>
          {weeks} {pluralRu(weeks, "неделя", "недели", "недель")} подряд
        </strong>
        <span>с пробежками — не прерывайте серию</span>
      </div>
    </div>
  );
}

function LatestRun({
  workout,
  onRecordRace
}: {
  workout: NonNullable<Highlights["latestWorkout"]>;
  onRecordRace: () => void;
}) {
  return (
    <article className="panel latest-run">
      <div className="latest-run-head">
        <strong>{workout.name}</strong>
        <span>{formatAgo(workout.start_date)}</span>
      </div>
      {workout.route ? <RouteStaticMap points={workout.route} /> : null}
      <div className="latest-run-stats">
        <div>
          <b className="num">{formatKm(workout.distance_meters, 2)} км</b>
          <span>дистанция</span>
        </div>
        <div>
          <b className="num">{formatPace(workout.average_speed).replace("/км", "")}</b>
          <span>темп /км</span>
        </div>
        <div>
          <b className="num">{workout.average_heartrate ? Math.round(workout.average_heartrate) : formatDuration(workout.moving_time_seconds)}</b>
          <span>{workout.average_heartrate ? "ср. пульс" : "время"}</span>
        </div>
      </div>
      {workout.coach_note ? (
        <div className="coach-note">
          <UserAvatar fullName={workout.coach_name ?? "Тренер"} avatarUrl={workout.coach_avatar_url} className="avatar-sm" ariaHidden />
          <div>
            <b>{workout.coach_name ?? "Тренер"}</b>
            <p>{workout.coach_note}</p>
          </div>
        </div>
      ) : null}
      {workout.race_hint ? (
        <button type="button" className="race-hint" onClick={onRecordRace}>
          <svg className="race-hint-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M5 21V4M5 4h11l-2 4 2 4H5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>
            <b>Похоже на старт — {workout.race_hint.label}</b>
            <span>Записать результат по протоколу?</span>
          </span>
        </button>
      ) : null}
      <div className="latest-run-actions">
        <ShareStoryButton workoutId={workout.id} role="athlete" title={workout.name} className="primary-button share-primary" />
        <Link className="secondary-button" to={`/athlete/workouts/${workout.id}`}>
          Разбор
        </Link>
      </div>
    </article>
  );
}

export function AthleteDashboardPage() {
  const { user } = useAuth();
  const { data, loading, error, refresh } = useApi<AthleteDashboardData>("/api/athlete/dashboard");
  const [extraWorkouts, setExtraWorkouts] = useState<WorkoutRow[]>([]);
  const [nextCursor, setNextCursor] = useState<AthleteDashboardData["nextCursor"]>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [tab, setTab] = useState<AthleteTab>("runs");
  const [raceDraft, setRaceDraft] = useState<ResultDraft | null>(null);

  useEffect(() => {
    if (data) {
      setExtraWorkouts([]);
      setNextCursor(data.nextCursor);
    }
  }, [data]);

  async function loadMore() {
    if (!nextCursor) return;
    setIsLoadingMore(true);
    try {
      const search = new URLSearchParams({ beforeDate: nextCursor.beforeDate, beforeId: String(nextCursor.beforeId) });
      const more = await api<AthleteDashboardData>(`/api/athlete/dashboard?${search.toString()}`);
      setExtraWorkouts((prev) => [...prev, ...more.workouts]);
      setNextCursor(more.nextCursor);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingMore(false);
    }
  }

  if (loading) {
    return (
      <div className="page-stack athlete-page">
        <div className="skeleton-block" style={{ height: 260, borderRadius: 20 }} />
        <div className="skeleton-block" style={{ height: 80 }} />
        <div className="skeleton-block" style={{ height: 320 }} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <section className="panel panel-pad">
        <h2 className="panel-title">Не удалось загрузить кабинет</h2>
        <p className="muted">{error || "Попробуйте обновить страницу."}</p>
      </section>
    );
  }

  const firstName = (user?.fullName ?? data.athlete.full_name).split(" ")[0];
  const workouts = [...data.workouts, ...extraWorkouts];
  const highlights = data.highlights;

  return (
    <div className="page-stack athlete-page">
      <p className="hello">Привет, {firstName}</p>

      {highlights ? <WeekHero highlights={highlights} week={data.stats.week} /> : null}

      <div className="period-strip">
        <div>
          <span>Месяц</span>
          <b className="num">{formatKm(data.stats.month.distance_meters)} км</b>
        </div>
        <div>
          <span>Год</span>
          <b className="num">{formatKm(data.stats.year.distance_meters)} км</b>
        </div>
        <div>
          <span>Всё время</span>
          <b className="num">{formatKm(data.stats.allTime.distance_meters)} км</b>
        </div>
      </div>

      {highlights ? <Streak weeks={highlights.streakWeeks} /> : null}

      {highlights?.latestWorkout ? (
        <LatestRun
          workout={highlights.latestWorkout}
          onRecordRace={() => {
            const latest = highlights.latestWorkout!;
            setRaceDraft({
              status: "finished",
              name: latest.name,
              raceDate: latest.start_date.slice(0, 10),
              distanceMeters: latest.race_hint?.distanceMeters ?? latest.distance_meters,
              officialTimeSeconds: latest.moving_time_seconds,
              workoutId: latest.id,
              watchDistanceMeters: latest.distance_meters
            });
          }}
        />
      ) : (
        <section className="panel panel-pad">
          <h2 className="panel-title">Пока нет пробежек</h2>
          <p className="muted">
            {data.athlete.connected_at
              ? "Пробежки появятся автоматически после следующей синхронизации с часами."
              : "Попросите администратора подключить синхронизацию intervals.icu — тренировки будут подтягиваться с часов сами."}
          </p>
        </section>
      )}

      <div className="segmented segmented-full" role="tablist" aria-label="Разделы">
        {(
          [
            ["runs", "Пробежки"],
            ["results", "Результаты"]
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? "segmented-item is-active" : "segmented-item"}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "results" && user ? (
        <ResultsPanel athleteId={user.id} viewer="self" />
      ) : (
        <>
          {workouts.length ? (
            <section className="panel">
              <ul className="run-list">
                {workouts.map((workout) => (
                  <li key={workout.id}>
                    <Link className="run-row run-row-simple" to={`/athlete/workouts/${workout.id}`}>
                      <div className="run-row-main">
                        <strong>{workout.name}</strong>
                        <span>
                          {formatAgo(workout.start_date)} · {formatPace(workout.average_speed)}
                        </span>
                      </div>
                      <div className="run-metric num">
                        {formatKm(workout.distance_meters)}
                        <small>км</small>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
              {nextCursor ? (
                <button type="button" className="panel-footer-link" disabled={isLoadingMore} onClick={loadMore}>
                  {isLoadingMore ? "Загружаем…" : "Показать ещё"}
                </button>
              ) : null}
            </section>
          ) : null}
          <AthleteTrends />
        </>
      )}

      {raceDraft && user ? (
        <ResultForm
          athleteId={user.id}
          draft={raceDraft}
          onClose={() => setRaceDraft(null)}
          onSaved={() => {
            setRaceDraft(null);
            setTab("results");
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}
