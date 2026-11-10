import { Link } from "react-router-dom";

import { useAuth } from "../components/AuthProvider";
import { UserAvatar } from "../components/UserAvatar";
import { ClubEvents } from "../components/ClubEvents";
import { useApi } from "../hooks/useApi";
import { formatAgo, formatDuration, formatKm, formatPace, pluralRu } from "../lib";

// Главная спортсмена — 4 блока (client/DESIGN.md): последняя пробежка с комментарием
// тренера · неделя · регулярность · ближайший старт. Заметной кнопки нет.

type FreshnessZone = "fresh" | "neutral" | "productive" | "overload";

type LatestWorkout = {
  id: number;
  name: string;
  start_date: string;
  distance_meters: number;
  moving_time_seconds: number;
  average_speed: number | null;
  average_heartrate: number | null;
  coach_note: string | null;
  coach_name: string | null;
  coach_avatar_url: string | null;
};

type Highlights = {
  weekStarts: string[];
  weeklyDistances: number[];
  streakWeeks: number;
  weekDays: number[];
  lastWeekToDateMeters: number;
  nextStart: { id: number; name: string; race_date: string; distance_meters: number; days_left: number } | null;
  freshness: { tsb: number; zone: FreshnessZone } | null;
  latestWorkout: LatestWorkout | null;
};

type AthleteDashboardData = {
  athlete: { id: number; full_name: string; connected_at: string | null };
  highlights: Highlights | null;
  stats: Record<"week", { distance_meters: number; workout_count: number }>;
};

const DAY_LABELS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const REGULARITY_WEEKS = 6;
const FRESH_WITHIN_MS = 48 * 3600 * 1000;

const FRESHNESS_TEXT: Record<FreshnessZone, { pill: string; text: string }> = {
  fresh: { pill: "ds-pill-good", text: "можно нагружаться" },
  neutral: { pill: "ds-pill-soft", text: "обычный режим" },
  productive: { pill: "ds-pill-soft", text: "идёт рост формы" },
  overload: { pill: "ds-pill-warn", text: "стоит восстановиться" }
};

// «1:25» для часа и больше, «42:10» — меньше часа
function shortDuration(seconds: number) {
  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}:${String(m).padStart(2, "0")}`;
  }
  return formatDuration(Math.round(seconds));
}

function todayIndex() {
  return (new Date().getDay() + 6) % 7;
}

function signedKm(meters: number) {
  const value = formatKm(Math.abs(meters));
  return `${meters >= 0 ? "+" : "−"}${value}`;
}

function LatestRunBlock({ workout }: { workout: LatestWorkout }) {
  return (
    <div className="ds-block ds-pad">
      <Link className="home-run-link" to={`/athlete/workouts/${workout.id}`} aria-label={`${workout.name} — открыть разбор`}>
        <div className="home-run-top">
          <b>{workout.name}</b>
          <span>{formatAgo(workout.start_date)} ›</span>
        </div>
        <div className="ds-metrics">
          <div className="ds-metric">
            <b>{formatKm(workout.distance_meters, 2)}</b>
            <span>км</span>
          </div>
          <div className="ds-metric">
            <b>{shortDuration(workout.moving_time_seconds)}</b>
            <span>время</span>
          </div>
          <div className="ds-metric">
            <b>{formatPace(workout.average_speed).replace("/км", "")}</b>
            <span>темп</span>
          </div>
          <div className="ds-metric">
            <b>{workout.average_heartrate ? Math.round(workout.average_heartrate) : "—"}</b>
            <span>пульс</span>
          </div>
        </div>
        {/* последнее сообщение тренера одной строкой — без синей плашки */}
        {workout.coach_note ? (
          <div className="home-coach">
            <UserAvatar fullName={workout.coach_name ?? "Тренер"} avatarUrl={workout.coach_avatar_url} className="chat-av" ariaHidden />
            <p>
              <b>Тренер:</b> {workout.coach_note}
            </p>
          </div>
        ) : (
          <p className="ds-pending" style={{ marginTop: 14 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
            Тренер ещё не прокомментировал
          </p>
        )}
      </Link>
    </div>
  );
}

function WeekBlock({ highlights, weekMeters }: { highlights: Highlights; weekMeters: number }) {
  const today = todayIndex();
  const max = Math.max(...highlights.weekDays, 1);
  const delta = weekMeters - highlights.lastWeekToDateMeters;
  const fresh = highlights.freshness;
  return (
    <section className="ds-block ds-pad" aria-label="Эта неделя">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--ink-muted)" }}>Эта неделя</span>
        {weekMeters > 0 ? (
          <span style={{ fontSize: 13.5, fontWeight: 700, color: delta >= 0 ? "var(--good-ink)" : "var(--ink-muted)" }}>
            {signedKm(delta)} км к прошлой
          </span>
        ) : null}
      </div>
      <div className="ds-big" style={{ margin: "8px 0 14px" }}>
        {formatKm(weekMeters)}
        <small>км</small>
      </div>
      {weekMeters === 0 ? (
        <p className="ds-sub" style={{ margin: "-6px 0 14px" }}>
          Неделя только началась
          {highlights.weeklyDistances.length > 1 && highlights.weeklyDistances[highlights.weeklyDistances.length - 2]! > 0
            ? ` · на прошлой\u00a0— ${formatKm(highlights.weeklyDistances[highlights.weeklyDistances.length - 2]!)}\u00a0км`
            : ""}
        </p>
      ) : null}
      <div
        className="home-days"
        role="img"
        aria-label={`По дням: ${highlights.weekDays
          .map((meters, index) => `${DAY_LABELS[index]} ${index > today ? "впереди" : meters ? `${formatKm(meters)} км` : "отдых"}`)
          .join(", ")}`}
      >
        {highlights.weekDays.map((meters, index) => {
          const cls = index > today ? "is-future" : !meters ? "is-zero" : index === today ? "is-today" : undefined;
          return <i key={index} className={cls} style={meters && index <= today ? { height: `${Math.max((meters / max) * 100, 10)}%` } : undefined} />;
        })}
      </div>
      <div className="home-dl" aria-hidden="true">
        {DAY_LABELS.map((label, index) => (
          <span key={label} className={index === today ? "is-today" : undefined}>
            {label}
          </span>
        ))}
      </div>
      {fresh ? (
        <div className="home-fresh">
          <span className={`ds-pill ${FRESHNESS_TEXT[fresh.zone].pill}`}>
            Свежесть {fresh.tsb > 0 ? "+" : fresh.tsb < 0 ? "−" : ""}
            {Math.abs(fresh.tsb)}
          </span>
          <span>{FRESHNESS_TEXT[fresh.zone].text}</span>
        </div>
      ) : null}
    </section>
  );
}

function RegularityBlock({ highlights }: { highlights: Highlights }) {
  const weeks = highlights.weeklyDistances.slice(-REGULARITY_WEEKS);
  const withRuns = weeks.filter((meters) => meters > 0).length;
  const streak = highlights.streakWeeks;
  return (
    <section className="ds-block ds-pad home-reg" aria-label="Регулярность">
      <div className="home-reg-dots" aria-hidden="true">
        {weeks.map((meters, index) => (
          <i key={index} className={meters > 0 ? undefined : "is-off"} />
        ))}
      </div>
      <div>
        <b>
          {withRuns} из {weeks.length} {pluralRu(weeks.length, "недели", "недель", "недель")} с бегом
        </b>
        <div className="home-reg-sub">
          {streak >= 2
            ? `последние ${streak} — подряд`
            : withRuns === 0
              ? "одна пробежка на этой неделе — и начнётся серия"
              : "каждая неделя с бегом идёт в счёт"}
        </div>
      </div>
    </section>
  );
}

function NextStartRow({ start }: { start: NonNullable<Highlights["nextStart"]> }) {
  const [, month, day] = start.race_date.split("-").map(Number);
  const when =
    start.days_left === 0 ? "сегодня" : `через ${start.days_left} ${pluralRu(start.days_left, "день", "дня", "дней")}`;
  return (
    <div className="ds-list">
      <Link className="ds-li" to="/athlete/starts">
        <svg className="ds-start-ic" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
        </svg>
        <div className="ds-m">
          <b>{start.name}</b>
          <span>
            {when} · {day} {MONTHS_GEN[month! - 1]}
          </span>
        </div>
        <Chevron />
      </Link>
    </div>
  );
}

export function Chevron() {
  return (
    <svg className="ds-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function AthleteDashboardPage() {
  const { user } = useAuth();
  const { data, loading, error } = useApi<AthleteDashboardData>("/api/athlete/dashboard");

  if (loading) {
    return (
      <div className="ds-screen">
        <div className="skeleton-block" style={{ height: 32, width: 200 }} />
        <div className="skeleton-block" style={{ height: 220, borderRadius: 16 }} />
        <div className="skeleton-block" style={{ height: 200, borderRadius: 16 }} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <section className="ds-block ds-pad">
        <h2 className="ds-title" style={{ fontSize: 20 }}>Не удалось загрузить кабинет</h2>
        <p className="ds-sub">{error || "Попробуйте обновить страницу."}</p>
      </section>
    );
  }

  const firstName = (user?.fullName ?? data.athlete.full_name).split(" ")[0];
  const highlights = data.highlights;
  const latest = highlights?.latestWorkout ?? null;
  const latestIsFresh = latest ? Date.now() - new Date(latest.start_date).getTime() <= FRESH_WITHIN_MS : false;

  const latestBlock = latest ? <LatestRunBlock workout={latest} /> : null;

  return (
    <div className="ds-screen">
      <h1 className="ds-title">Привет, {firstName}</h1>

      {latestIsFresh ? latestBlock : null}

      {highlights ? <WeekBlock highlights={highlights} weekMeters={data.stats.week.distance_meters} /> : null}

      {highlights ? <RegularityBlock highlights={highlights} /> : null}

      {!latestIsFresh ? latestBlock : null}

      {highlights?.nextStart ? <NextStartRow start={highlights.nextStart} /> : null}

      {!latest ? (
        <section className="ds-block ds-pad">
          <b style={{ fontSize: 17 }}>Пока нет пробежек</b>
          <p className="ds-sub">
            {data.athlete.connected_at
              ? "Пробежки появятся сами после следующей синхронизации с часами."
              : "Попросите администратора подключить intervals.icu — тренировки будут подтягиваться с часов сами."}
          </p>
        </section>
      ) : null}

      {/* последним блоком — «В клубе»: поддержка без сравнения (отчёт «Личный профиль и здоровье») */}
      <ClubEvents />
    </div>
  );
}
