import { pool } from "./db.js";
import { getDailyLoads, computeFitnessSeries, summarizeFitness } from "./fitness.js";
import { getAthleteZones, getWorkoutZoneSeconds } from "./hr-zones.js";
import { getThreshold, paceZoneBounds, paceZonesFor } from "./pace-zones.js";

// Циклы в карточке спортсмена у тренера: неделя по дням · 4 недели по неделям ·
// сезон (26 недель) — км, набор, время, зоны пульса и сравнение с прошлым таким же периодом.
export type CycleLevel = "week" | "blocks" | "season";

const PERIODS: Record<CycleLevel, { bars: string; previous: string }> = {
  week: {
    bars: `select gs as start, gs + interval '1 day' as finish
           from generate_series(date_trunc('week', now()), date_trunc('week', now()) + interval '6 days', interval '1 day') gs`,
    // к этому же моменту прошлой недели
    previous: `select date_trunc('week', now()) - interval '1 week' as start, now() - interval '1 week' as finish`
  },
  blocks: {
    bars: `select gs as start, gs + interval '1 week' as finish
           from generate_series(date_trunc('week', now()) - interval '3 weeks', date_trunc('week', now()), interval '1 week') gs`,
    previous: `select date_trunc('week', now()) - interval '7 weeks' as start, now() - interval '4 weeks' as finish`
  },
  season: {
    bars: `select gs as start, gs + interval '1 week' as finish
           from generate_series(date_trunc('week', now()) - interval '25 weeks', date_trunc('week', now()), interval '1 week') gs`,
    previous: `select date_trunc('week', now()) - interval '51 weeks' as start, now() - interval '26 weeks' as finish`
  }
};

type Totals = { distance_meters: number; elevation_gain: number; moving_time_seconds: number; workout_count: number };

async function totalsBetween(athleteId: number, from: Date, to: Date) {
  const { rows } = await pool.query(
    `
      select w.id, w.start_date,
             coalesce(wc.corrected_distance_meters, w.distance_meters)::float8 as distance_meters,
             coalesce(wc.corrected_elevation_gain, w.elevation_gain, 0)::float8 as elevation_gain,
             coalesce(wc.corrected_moving_time_seconds, w.moving_time_seconds, 0)::float8 as moving_time_seconds
      from workouts w
      left join workout_corrections wc on wc.workout_id = w.id
      where w.user_id = $1 and w.start_date >= $2 and w.start_date < $3
    `,
    [athleteId, from, to]
  );
  return rows;
}

async function zonesFor(workoutIds: number[]) {
  const total = [0, 0, 0, 0, 0];
  for (const seconds of (await getWorkoutZoneSeconds(workoutIds)).values()) {
    seconds.forEach((value, zone) => (total[zone]! += value));
  }
  return total;
}

function sum(rows: Array<Record<string, unknown>>): Totals {
  return rows.reduce<Totals>(
    (acc, row) => ({
      distance_meters: acc.distance_meters + (Number(row.distance_meters) || 0),
      elevation_gain: acc.elevation_gain + (Number(row.elevation_gain) || 0),
      moving_time_seconds: acc.moving_time_seconds + (Number(row.moving_time_seconds) || 0),
      workout_count: acc.workout_count + 1
    }),
    { distance_meters: 0, elevation_gain: 0, moving_time_seconds: 0, workout_count: 0 }
  );
}

export async function getAthleteCycles(athleteId: number, level: CycleLevel) {
  const spec = PERIODS[level];
  const [barsResult, previousResult] = await Promise.all([pool.query(`${spec.bars} order by start`), pool.query(spec.previous)]);
  const bars = barsResult.rows.map((row) => ({ start: new Date(row.start), finish: new Date(row.finish) }));
  const from = bars[0]!.start;
  const to = bars[bars.length - 1]!.finish;
  const rows = await totalsBetween(athleteId, from, to);
  const previousRows = await totalsBetween(athleteId, new Date(previousResult.rows[0].start), new Date(previousResult.rows[0].finish));
  const workoutIds = rows.map((row) => Number(row.id));
  const [zoneSeconds, threshold] = await Promise.all([zonesFor(workoutIds), getThreshold(athleteId)]);
  const paceZoneSeconds = threshold ? await paceZonesFor(workoutIds, threshold.pace_seconds_per_km) : null;
  return {
    threshold,
    pace_zone_bounds: threshold ? paceZoneBounds(threshold.pace_seconds_per_km) : null,
    pace_zone_seconds: paceZoneSeconds,
    level,
    bars: bars.map((bar) => {
      const inBar = rows.filter((row) => {
        const at = new Date(row.start_date).getTime();
        return at >= bar.start.getTime() && at < bar.finish.getTime();
      });
      return { start: bar.start.toISOString(), distance_meters: sum(inBar).distance_meters };
    }),
    totals: sum(rows),
    previous: sum(previousRows),
    zone_seconds: zoneSeconds,
    hr_zones: (await getAthleteZones([athleteId])).get(athleteId) ?? null
  };
}

// Состояние: форма / усталость / свежесть и самочувствие за 2 недели
export async function getAthleteState(athleteId: number) {
  const loads = await getDailyLoads([athleteId]);
  const series = computeFitnessSeries(loads.get(athleteId) ?? []);
  const fitness = series.some((point) => point.load > 0) ? summarizeFitness(series) : null;
  const { rows } = await pool.query(
    `
      select count(*) filter (where f.effort = 'hard') as hard,
             count(*) filter (where f.pain = 'light') as pain,
             count(*) filter (where f.effort is not null or f.pain is not null) as marked
      from workout_feelings f
      join workouts w on w.id = f.workout_id
      where f.user_id = $1 and w.start_date >= now() - interval '14 days'
    `,
    [athleteId]
  );
  const next = await pool.query(
    `select (race_date - current_date) as days_left from race_results
     where user_id = $1 and status = 'planned' and race_date >= current_date order by race_date limit 1`,
    [athleteId]
  );
  // 12 недель по дням — для графика формы/усталости/свежести в карточке тренера
  const fitness_series = fitness
    ? series.slice(-84).map((point) => ({
        date: point.date,
        ctl: Math.round(point.ctl * 10) / 10,
        atl: Math.round(point.atl * 10) / 10,
        tsb: Math.round(point.tsb * 10) / 10
      }))
    : [];
  const bd = await pool.query(`select birthday_day, birthday_month, birthday_hidden from users where id = $1`, [athleteId]);
  const birthday = bd.rows[0]?.birthday_day
    ? { day: Number(bd.rows[0].birthday_day), month: Number(bd.rows[0].birthday_month), hidden: Boolean(bd.rows[0].birthday_hidden) }
    : null;
  return {
    fitness,
    fitness_series,
    birthday,
    next_start_days: next.rows[0] ? Number(next.rows[0].days_left) : null,
    feelings: { hard: Number(rows[0]?.hard ?? 0), pain: Number(rows[0]?.pain ?? 0), marked: Number(rows[0]?.marked ?? 0) }
  };
}
