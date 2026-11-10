import { pool } from "./db.js";
import { getAthleteResults } from "./race-results.js";
import { getWeeklyVolume } from "./weekly-volume.js";

// Страница одногруппника: только то, что видно группе. Самочувствие, боль, комментарии
// тренера, форма/усталость и зоны сюда не попадают — это видит только тренер.
const RECENT_LIMIT = 5;
const FRESH_PB_DAYS = 14;
const LUCK_DAYS = 7;
const PAUSE_DAYS = 21;
const NEWCOMER_DAYS = 30;

export async function getTeammateProfile(viewerId: number, athleteId: number) {
  const [profile, volume, recent, nextStart, results, lastRun] = await Promise.all([
    pool.query(
      `select u.id, u.full_name, u.avatar_url, u.created_at, u.telegram_username, c.full_name as coach_name
       from users u left join users c on c.id = u.coach_id
       where u.id = $1 and u.role = 'athlete'`,
      [athleteId]
    ),
    getWeeklyVolume([athleteId], 12),
    pool.query(
      `select w.id, w.name, w.start_date,
              coalesce(wc.corrected_distance_meters, w.distance_meters) as distance_meters,
              coalesce(wc.corrected_average_speed, w.average_speed) as average_speed,
              coalesce(wc.corrected_average_heartrate, w.average_heartrate) as average_heartrate
       from workouts w left join workout_corrections wc on wc.workout_id = w.id
       where w.user_id = $1
       order by w.start_date desc, w.id desc limit $2`,
      [athleteId, RECENT_LIMIT]
    ),
    pool.query(
      `select r.id, r.name, r.race_date, r.distance_meters, r.city,
              exists (
                select 1 from race_results mine
                where mine.user_id = $2 and mine.status = 'planned'
                  and mine.race_date = r.race_date and mine.distance_meters = r.distance_meters
              ) as viewer_too
       from race_results r
       where r.user_id = $1 and r.status = 'planned' and r.race_date >= current_date
       order by r.race_date asc, r.id asc limit 1`,
      [athleteId, viewerId]
    ),
    getAthleteResults(athleteId),
    pool.query(
      `select max(start_date) as last_at,
              coalesce(sum(coalesce(wc.corrected_distance_meters, w.distance_meters))
                filter (where w.start_date >= date_trunc('week', now()) - interval '3 weeks'), 0) as km4_m,
              count(*) filter (where w.start_date >= date_trunc('week', now()) - interval '3 weeks') as runs4,
              count(distinct date_trunc('week', w.start_date))
                filter (where w.start_date >= date_trunc('week', now()) - interval '3 weeks') as weeks4
       from workouts w left join workout_corrections wc on wc.workout_id = w.id
       where w.user_id = $1`,
      [athleteId]
    )
  ]);
  const person = profile.rows[0];
  if (!person) return null;

  const now = Date.now();
  const daysSince = (value: string | Date | null) =>
    value ? Math.floor((now - new Date(value).getTime()) / 86_400_000) : null;

  const stats = lastRun.rows[0];
  const lastRunDays = daysSince(stats.last_at);
  const memberDays = daysSince(person.created_at) ?? 0;
  const start = nextStart.rows[0];
  const startDays = start ? Math.max(0, Math.round((new Date(start.race_date).getTime() - now) / 86_400_000)) : null;

  const freshBest = results.personalBests.find(
    (best) => best.result && (daysSince(best.result.race_date) ?? 99) <= FRESH_PB_DAYS
  );

  // одна главная кнопка — по моменту: рекорд → старт скоро → пауза → новичок
  const recentIds = recent.rows.map((row) => Number(row.id));
  let moment: { kind: "record" | "luck" | "support" | "welcome"; workoutId: number | null } | null = null;
  if (freshBest) moment = { kind: "record", workoutId: freshBest.result!.workout_id ?? recentIds[0] ?? null };
  else if (startDays !== null && startDays <= LUCK_DAYS) moment = { kind: "luck", workoutId: recentIds[0] ?? null };
  else if (lastRunDays !== null && lastRunDays >= PAUSE_DAYS) moment = { kind: "support", workoutId: recentIds[0] ?? null };
  else if (memberDays <= NEWCOMER_DAYS) moment = { kind: "welcome", workoutId: recentIds[0] ?? null };

  return {
    athlete: {
      id: Number(person.id),
      full_name: String(person.full_name),
      avatar_url: person.avatar_url ?? null,
      coach_name: person.coach_name ?? null,
      member_since: person.created_at,
      telegram_username: person.telegram_username ?? null
    },
    last4: {
      distance_meters: Number(stats.km4_m ?? 0),
      runs: Number(stats.runs4 ?? 0),
      weeks_with_runs: Number(stats.weeks4 ?? 0)
    },
    weekStarts: volume.weekStarts,
    weeklyDistances: volume.byUser.get(athleteId) ?? [],
    last_run_at: stats.last_at ?? null,
    paused: lastRunDays !== null && lastRunDays >= PAUSE_DAYS,
    nextStart: start
      ? {
          id: Number(start.id),
          name: String(start.name),
          race_date: start.race_date,
          distance_meters: Number(start.distance_meters),
          days: startDays,
          viewer_too: Boolean(start.viewer_too)
        }
      : null,
    personalBests: results.personalBests,
    freshBestDistance: freshBest?.distanceMeters ?? null,
    recent: recent.rows.map((row) => ({
      id: Number(row.id),
      name: String(row.name ?? ""),
      start_date: row.start_date,
      distance_meters: Number(row.distance_meters ?? 0),
      average_speed: row.average_speed === null ? null : Number(row.average_speed),
      average_heartrate: row.average_heartrate === null ? null : Number(row.average_heartrate)
    })),
    moment
  };
}
