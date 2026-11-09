import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../api";
import { useApi } from "../hooks/useApi";
import { formatDuration, formatKm, formatPace } from "../lib";

// Вкладка «Пробежки»: километраж по неделям одним графиком и хронологический
// список, сгруппированный по неделям с суммой в заголовке группы.

type WorkoutRow = {
  id: number;
  name: string;
  start_date: string;
  distance_meters: number;
  moving_time_seconds: number;
  average_speed: number | null;
  has_feedback: boolean;
  is_race: boolean;
};

type RunsData = {
  highlights: { weekStarts: string[]; weeklyDistances: number[] } | null;
  workouts: WorkoutRow[];
  nextCursor: { beforeDate: string; beforeId: number } | null;
};

const DAY_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

// понедельник недели в локальном времени — ключ группы
function weekStart(date: Date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

function weekLabel(start: Date, currentStart: Date) {
  if (start.getTime() === currentStart.getTime()) return "Эта неделя";
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return start.getMonth() === end.getMonth()
    ? `${start.getDate()}–${end.getDate()} ${MONTHS[end.getMonth()]}`
    : `${start.getDate()} ${MONTHS[start.getMonth()]} – ${end.getDate()} ${MONTHS[end.getMonth()]}`;
}

function groupByWeek(workouts: WorkoutRow[]) {
  const groups: { start: Date; meters: number; rows: WorkoutRow[] }[] = [];
  for (const workout of workouts) {
    const start = weekStart(new Date(workout.start_date));
    const last = groups[groups.length - 1];
    if (last && last.start.getTime() === start.getTime()) {
      last.rows.push(workout);
      last.meters += workout.distance_meters;
    } else {
      groups.push({ start, meters: workout.distance_meters, rows: [workout] });
    }
  }
  return groups;
}

function CommentIcon() {
  return (
    <svg className="runs-cm" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-label="есть комментарий тренера" role="img">
      <path d="M4 5h16v11H9l-5 4V5z" />
    </svg>
  );
}

// догруженные страницы списка живут дольше экрана: после «назад» список той же
// длины, и прокрутка встаёт на прежнее место
let rememberedExtra: { firstId: number | null; items: WorkoutRow[]; cursor: RunsData["nextCursor"] } | null = null;

export function AthleteRunsPage() {
  const { data, loading, error } = useApi<RunsData>("/api/athlete/dashboard");
  const [extra, setExtra] = useState<WorkoutRow[]>(() => rememberedExtra?.items ?? []);
  const [cursor, setCursor] = useState<RunsData["nextCursor"]>(() => rememberedExtra?.cursor ?? null);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!data) return;
    const firstId = data.workouts[0]?.id ?? null;
    if (rememberedExtra && rememberedExtra.firstId === firstId) {
      setExtra(rememberedExtra.items);
      setCursor(rememberedExtra.cursor);
    } else {
      setExtra([]);
      setCursor(data.nextCursor);
    }
  }, [data]);

  useEffect(() => {
    if (data) rememberedExtra = { firstId: data.workouts[0]?.id ?? null, items: extra, cursor };
  }, [data, extra, cursor]);

  // подгрузка при прокрутке: следующая страница, когда низ списка близко
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !cursor) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { rootMargin: "600px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  });

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const search = new URLSearchParams({ beforeDate: cursor.beforeDate, beforeId: String(cursor.beforeId) });
      const more = await api<RunsData>(`/api/athlete/dashboard?${search.toString()}`);
      setExtra((prev) => [...prev, ...more.workouts]);
      setCursor(more.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  if (loading) {
    return (
      <div className="ds-screen">
        <div className="skeleton-block" style={{ height: 32, width: 180 }} />
        <div className="skeleton-block" style={{ height: 130, borderRadius: 16 }} />
        <div className="skeleton-block" style={{ height: 320, borderRadius: 16 }} />
      </div>
    );
  }
  if (error || !data) {
    return (
      <section className="ds-block ds-pad">
        <p className="ds-sub">{error || "Не удалось загрузить пробежки"}</p>
      </section>
    );
  }

  const weeks = data.highlights?.weeklyDistances ?? [];
  const weekStarts = data.highlights?.weekStarts ?? [];
  const finished = weeks.slice(0, -1);
  const average = finished.length ? finished.reduce((sum, value) => sum + value, 0) / finished.length : 0;
  const max = Math.max(...weeks, 1);
  const workouts = [...data.workouts, ...extra];
  const groups = groupByWeek(workouts);
  const currentStart = weekStart(new Date());
  const firstWeek = weekStarts[0] ? new Date(weekStarts[0]) : null;

  return (
    <div className="ds-screen" style={{ gap: 20 }}>
      <div>
        <h1 className="ds-title">Пробежки</h1>
        {weeks.length ? (
          <p className="ds-sub">
            В среднем {formatKm(average)} км в неделю за {weeks.length} недель
          </p>
        ) : null}
      </div>

      {weeks.length ? (
        <section className="ds-block ds-pad" aria-label="Километраж по неделям">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <b style={{ fontSize: 15 }}>Километраж по неделям</b>
            <span style={{ fontSize: 13, color: "var(--ink-muted)", fontWeight: 600 }}>{weeks.length} недель</span>
          </div>
          <div
            className="runs-vol"
            role="img"
            aria-label={`Объём за ${weeks.length} недель: ${weeks.map((meters) => formatKm(meters)).join(", ")} км, последняя — эта неделя`}
          >
            {weeks.map((meters, index) => (
              <i
                key={weekStarts[index] ?? index}
                className={index === weeks.length - 1 ? "is-current" : undefined}
                style={{ height: `${Math.max((meters / max) * 100, 4)}%` }}
                title={`${formatKm(meters)} км`}
              />
            ))}
          </div>
          <div className="runs-vax">
            <span>{firstWeek ? `${firstWeek.getDate()} ${MONTHS[firstWeek.getMonth()]}` : ""}</span>
            <span>эта неделя</span>
          </div>
        </section>
      ) : null}

      {groups.length ? (
        <div>
          {groups.map((group, index) => (
            <div key={group.start.toISOString()}>
              <div className="ds-grp" style={index ? { paddingTop: 20 } : undefined}>
                <span>{weekLabel(group.start, currentStart)}</span>
                <b>{formatKm(group.meters)} км</b>
              </div>
              <div className="ds-list">
                {group.rows.map((workout) => {
                  const date = new Date(workout.start_date);
                  return (
                    <Link key={workout.id} className="ds-li" to={`/athlete/workouts/${workout.id}`}>
                      <div className="runs-dd">
                        <b>{date.getDate()}</b>
                        <span>{DAY_SHORT[date.getDay()]}</span>
                      </div>
                      <div className="ds-m">
                        <b>{workout.name}</b>
                        <span>
                          {formatDuration(Math.round(workout.moving_time_seconds))} · {formatPace(workout.average_speed).replace("/км", " /км")}
                          {workout.is_race ? " · старт" : ""}
                        </span>
                      </div>
                      {workout.has_feedback ? <CommentIcon /> : null}
                      <div className="ds-v">{formatKm(workout.distance_meters)}</div>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
          {cursor ? (
            <div ref={sentinelRef} className="runs-more" aria-live="polite">
              {loadingMore ? "Загружаем…" : ""}
            </div>
          ) : null}
        </div>
      ) : (
        <section className="ds-block ds-pad">
          <b style={{ fontSize: 17 }}>Пока нет пробежек</b>
          <p className="ds-sub">Они появятся сами после синхронизации с часами.</p>
        </section>
      )}
    </div>
  );
}
