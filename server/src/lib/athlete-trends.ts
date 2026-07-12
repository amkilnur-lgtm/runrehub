import { pool } from "./db.js";
import { checkStreamQuality } from "./workout-analysis.js";

const WEEKS = 12;
const PACE_MONTHS = 6;
// аэробная зона относительно оценки HRmax; фолбэк — типичный диапазон любителя
const AEROBIC_HR_LOW_RATIO = 0.62;
const AEROBIC_HR_HIGH_RATIO = 0.79;
const FALLBACK_HR_RANGE = { low: 120, high: 152 };
const RECORD_TARGETS_METERS = [1000, 5000, 10000];

export type WeeklyTrendRow = {
  week_start: string;
  distance_meters: number;
  runs: number;
};

export type AerobicPaceRow = {
  month_start: string;
  avg_speed: number;
  runs: number;
};

export type WeeklyLoadRow = {
  week_start: string;
  load: number;
  acwr: number | null;
};

export type DistanceRecord = {
  target_meters: number;
  seconds: number;
  workout_id: number;
  workout_name: string;
  start_date: string;
};

async function getAerobicHrRange(userId: number) {
  const { rows } = await pool.query(
    `
      select max(wa.estimated_hrmax)::float8 as hrmax
      from workout_analysis wa
      join workouts w on w.id = wa.workout_id
      where w.user_id = $1 and wa.estimated_hrmax is not null
    `,
    [userId]
  );
  const hrmax = Number(rows[0]?.hrmax ?? NaN);
  if (!Number.isFinite(hrmax) || hrmax < 150) {
    return FALLBACK_HR_RANGE;
  }
  return {
    low: Math.round(hrmax * AEROBIC_HR_LOW_RATIO),
    high: Math.round(hrmax * AEROBIC_HR_HIGH_RATIO)
  };
}

async function getWeeklyDistance(userId: number): Promise<WeeklyTrendRow[]> {
  const { rows } = await pool.query(
    `
      with weeks as (
        select (date_trunc('week', now())::date - (series.value * 7))::date as week_start
        from generate_series(0, $2::int - 1) as series(value)
      )
      select
        weeks.week_start::text as week_start,
        coalesce(sum(coalesce(wc.corrected_distance_meters, w.distance_meters)), 0)::float8 as distance_meters,
        count(w.id)::int as runs
      from weeks
      left join workouts w
        on w.user_id = $1
       and (w.start_date::date - (extract(isodow from w.start_date)::int - 1))::date = weeks.week_start
      left join workout_corrections wc on wc.workout_id = w.id
      group by weeks.week_start
      order by weeks.week_start asc
    `,
    [userId, WEEKS]
  );
  return rows;
}

async function getAerobicPace(userId: number, hrRange: { low: number; high: number }): Promise<AerobicPaceRow[]> {
  const { rows } = await pool.query(
    `
      select
        date_trunc('month', w.start_date)::date::text as month_start,
        avg(coalesce(wc.corrected_average_speed, w.average_speed))::float8 as avg_speed,
        count(*)::int as runs
      from workouts w
      left join workout_corrections wc on wc.workout_id = w.id
      where w.user_id = $1
        and w.start_date >= date_trunc('month', now()) - make_interval(months => $2::int - 1)
        and coalesce(wc.corrected_average_heartrate, w.average_heartrate) between $3 and $4
        and coalesce(wc.corrected_distance_meters, w.distance_meters) >= 3000
        and coalesce(wc.corrected_average_speed, w.average_speed) > 0
      group by 1
      order by 1 asc
    `,
    [userId, PACE_MONTHS, hrRange.low, hrRange.high]
  );
  return rows;
}

// Лучшее скользящее время на целевую дистанцию по стримам (метод двух указателей).
// Стрим дистанции кумулятивный; немонотонные глюки пропускаем.
export function bestRollingTime(distance: number[], time: number[], targetMeters: number) {
  const size = Math.min(distance.length, time.length);
  let best: number | null = null;
  let start = 0;
  for (let end = 0; end < size; end += 1) {
    while (start < end && (distance[end] ?? 0) - (distance[start + 1] ?? 0) >= targetMeters) {
      start += 1;
    }
    if ((distance[end] ?? 0) - (distance[start] ?? 0) >= targetMeters) {
      const elapsed = (time[end] ?? 0) - (time[start] ?? 0);
      if (elapsed > 0 && (best === null || elapsed < best)) {
        best = elapsed;
      }
    }
  }
  return best;
}

async function getDistanceRecords(userId: number): Promise<DistanceRecord[]> {
  const minTarget = Math.min(...RECORD_TARGETS_METERS);
  // Статус анализа не используем: он бракует тренировки и по пульсу,
  // а для рекорда на дистанцию важно только качество GPS-стрима.
  const { rows } = await pool.query(
    `
      select w.id, w.name, w.start_date::text as start_date,
             w.distance_meters,
             s.distance_stream, s.time_stream
      from workouts w
      join workout_streams s on s.workout_id = w.id
      where w.user_id = $1
        and w.distance_meters >= $2
    `,
    [userId, minTarget]
  );

  const best = new Map<number, DistanceRecord>();
  for (const row of rows) {
    const distance = Array.isArray(row.distance_stream) ? (row.distance_stream as number[]) : [];
    const time = Array.isArray(row.time_stream) ? (row.time_stream as number[]) : [];
    if (distance.length < 2) continue;
    if (!checkStreamQuality(distance, time, Number(row.distance_meters)).ok) continue;

    for (const target of RECORD_TARGETS_METERS) {
      const totalDistance = distance[distance.length - 1]! - distance[0]!;
      if (totalDistance < target) continue;
      const seconds = bestRollingTime(distance, time, target);
      if (seconds === null) continue;
      const current = best.get(target);
      if (!current || seconds < current.seconds) {
        best.set(target, {
          target_meters: target,
          seconds: Math.round(seconds),
          workout_id: row.id as number,
          workout_name: row.name as string,
          start_date: row.start_date as string
        });
      }
    }
  }

  return RECORD_TARGETS_METERS.flatMap((target) => {
    const record = best.get(target);
    return record ? [record] : [];
  });
}

// ACWR: острая нагрузка (неделя) к хронической (среднее за 4 недели, включая текущую).
// Для хроники нужны 3 недели до окна — берем WEEKS + 3 и отбрасываем хвост.
async function getWeeklyLoad(userId: number): Promise<WeeklyLoadRow[]> {
  const totalWeeks = WEEKS + 3;
  const { rows } = await pool.query(
    `
      with weeks as (
        select (date_trunc('week', now())::date - (series.value * 7))::date as week_start
        from generate_series(0, $2::int - 1) as series(value)
      )
      select
        weeks.week_start::text as week_start,
        coalesce(sum(wa.training_load), 0)::float8 as load
      from weeks
      left join workouts w
        on w.user_id = $1
       and (w.start_date::date - (extract(isodow from w.start_date)::int - 1))::date = weeks.week_start
      left join workout_analysis wa on wa.workout_id = w.id
      group by weeks.week_start
      order by weeks.week_start asc
    `,
    [userId, totalWeeks]
  );

  const loads = rows.map((row: { load: number }) => row.load);
  // в первые 3 недели после самой первой тренировки хроника еще не набрана —
  // ACWR был бы искусственно завышен, не показываем его
  const firstLoadedWeek = loads.findIndex((value) => value > 0);
  return rows.slice(3).map((row: { week_start: string; load: number }, index: number) => {
    const absolute = index + 3;
    const chronicWindow = loads.slice(absolute - 3, absolute + 1);
    const chronic = chronicWindow.reduce((sum: number, value: number) => sum + value, 0) / chronicWindow.length;
    const chronicReady = firstLoadedWeek >= 0 && absolute >= firstLoadedWeek + 3;
    return {
      week_start: row.week_start,
      load: Math.round(row.load),
      acwr: chronicReady && chronic > 0 ? Math.round((row.load / chronic) * 100) / 100 : null
    };
  });
}

export async function getAthleteTrends(userId: number) {
  const hrRange = await getAerobicHrRange(userId);
  const [weekly, aerobicPace, records, loadWeekly] = await Promise.all([
    getWeeklyDistance(userId),
    getAerobicPace(userId, hrRange),
    getDistanceRecords(userId),
    getWeeklyLoad(userId)
  ]);
  return { weekly, aerobicPace, aerobicHrRange: hrRange, records, loadWeekly };
}
