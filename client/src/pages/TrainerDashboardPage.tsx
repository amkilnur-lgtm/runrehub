import { Link } from "react-router-dom";

import { GroupHeatmap } from "../components/GroupHeatmap";
import { formatGoalTime } from "../components/Results";
import { UserAvatar } from "../components/UserAvatar";
import { useApi } from "../hooks/useApi";
import { formatAgo, formatKm, pluralRu } from "../lib";

// «Группа» тренера (client/DESIGN.md): сначала очереди — кому я сейчас нужен,
// потом тепловая карта группы по периодам.

type DashboardData = {
  athletes: Array<{ id: number; full_name: string; avatar_url: string | null; last_workout_at: string | null }>;
  recentWorkouts: Array<{
    id: number;
    user_id: number;
    name: string;
    start_date: string;
    distance_meters: number;
    athlete_name: string;
    athlete_avatar_url: string | null;
    has_feedback: boolean;
    is_this_week: boolean;
  }>;
  feedback: { pendingCount: number };
  upcomingStarts: Array<{
    id: number;
    user_id: number;
    name: string;
    race_date: string;
    distance_meters: number;
    goal_time_seconds: number | null;
    athlete_name: string;
    athlete_avatar_url: string | null;
  }>;
  stats: { week: { athlete_count: number; active_athlete_count: number; distance_meters: number } };
};

const INACTIVE_DAYS = 5;
const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function Chevron() {
  return (
    <svg className="ds-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function daysSince(iso: string | null) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function raceDay(iso: string) {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  const date = new Date(year!, month! - 1, day!);
  return { date, label: `${WEEKDAYS[date.getDay()]}, ${day} ${MONTHS[month! - 1]}` };
}

export function TrainerDashboardPage() {
  const { data, loading, error } = useApi<DashboardData>("/api/trainer/dashboard");

  if (loading && !data) {
    return (
      <div className="ds-screen is-wide">
        <div className="skeleton-block" style={{ height: 32, width: 180 }} />
        <div className="skeleton-block" style={{ height: 220, borderRadius: 16 }} />
        <div className="skeleton-block" style={{ height: 320, borderRadius: 16 }} />
      </div>
    );
  }
  if (error || !data) {
    return (
      <section className="ds-block ds-pad">
        <p className="ds-sub">{error || "Не удалось загрузить группу"}</p>
      </section>
    );
  }

  // ждут комментария — только пробежки этой недели
  const pending = data.recentWorkouts.filter((workout) => workout.is_this_week && !workout.has_feedback);
  const inactive = data.athletes
    .map((athlete) => ({ athlete, days: daysSince(athlete.last_workout_at) }))
    .filter(({ days }) => days === null || days >= INACTIVE_DAYS)
    .sort((a, b) => (b.days ?? 9999) - (a.days ?? 9999));
  const weekEnd = new Date();
  weekEnd.setHours(0, 0, 0, 0);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const startsSoon = data.upcomingStarts.filter((start) => raceDay(start.race_date).date < weekEnd);
  const week = data.stats.week;

  return (
    <div className="ds-screen is-wide group-screen">
      <div>
        <h1 className="ds-title">Группа</h1>
        <p className="ds-sub">
          Бегали на этой неделе {week.active_athlete_count} из {week.athlete_count}
          {week.distance_meters > 0 ? ` · ${formatKm(week.distance_meters)} км` : ""}
        </p>
      </div>

      <div className="group-layout">
        <div className="group-queues">
          <div>
            <div className="ds-grp">
              <span>
                Ждут комментария · <b className="group-count">{data.feedback.pendingCount}</b>
              </span>
              {pending.length ? (
                <Link className="ds-link" style={{ fontSize: 14 }} to="/trainer/review">
                  Все
                </Link>
              ) : null}
            </div>
            {pending.length ? (
              <>
                <div className="ds-list">
                  {pending.slice(0, 3).map((workout) => (
                    <Link key={workout.id} className="ds-li" to={`/trainer/workouts/${workout.id}`}>
                      <UserAvatar fullName={workout.athlete_name} avatarUrl={workout.athlete_avatar_url} className="avatar-sm" />
                      <div className="ds-m">
                        <b>{workout.athlete_name.split(" ")[0]}</b>
                        <span>
                          {workout.name} · {formatKm(workout.distance_meters)} км · {formatAgo(workout.start_date)}
                        </span>
                      </div>
                      <Chevron />
                    </Link>
                  ))}
                </div>
                <Link className="ds-btn ds-btn-1 ds-btn-full" style={{ marginTop: 12 }} to="/trainer/review">
                  Разобрать по очереди
                </Link>
              </>
            ) : (
              <div className="ds-list">
                <div className="ds-li">
                  <div className="ds-m">
                    <span>На этой неделе всё прокомментировано</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {inactive.length ? (
            <div>
              <div className="ds-grp">
                <span>Не бегали {INACTIVE_DAYS}+ дней</span>
              </div>
              <div className="ds-list">
                {inactive.map(({ athlete, days }) => (
                  <Link key={athlete.id} className="ds-li" to={`/trainer/athletes/${athlete.id}`}>
                    <UserAvatar fullName={athlete.full_name} avatarUrl={athlete.avatar_url} className="avatar-sm" />
                    <div className="ds-m">
                      <b>{athlete.full_name.split(" ")[0]}</b>
                      <span>
                        {days === null
                          ? "ещё не бегал(а)"
                          : `последняя — ${days} ${pluralRu(days, "день", "дня", "дней")} назад`}
                      </span>
                    </div>
                    <Chevron />
                  </Link>
                ))}
              </div>
            </div>
          ) : null}

          {startsSoon.length ? (
            <div>
              <div className="ds-grp">
                <span>Старты на этой неделе</span>
              </div>
              <div className="ds-list">
                {startsSoon.map((start) => (
                  <Link key={start.id} className="ds-li" to={`/trainer/athletes/${start.user_id}`}>
                    <UserAvatar fullName={start.athlete_name} avatarUrl={start.athlete_avatar_url} className="avatar-sm" />
                    <div className="ds-m">
                      <b>{start.athlete_name.split(" ")[0]}</b>
                      <span>
                        {start.name} · {formatKm(start.distance_meters, start.distance_meters % 1000 ? 1 : 0)} км · {raceDay(start.race_date).label}
                      </span>
                    </div>
                    {start.goal_time_seconds ? <span className="ds-pill ds-pill-soft">цель {formatGoalTime(start.goal_time_seconds)}</span> : null}
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="group-main">
          <GroupHeatmap />
        </div>
      </div>
    </div>
  );
}
