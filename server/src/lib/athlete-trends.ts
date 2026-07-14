import { pool } from "./db.js";

const WEEKS = 12;
const PACE_MONTHS = 6;
// аэробная зона относительно оценки HRmax; фолбэк — типичный диапазон любителя
const AEROBIC_HR_LOW_RATIO = 0.62;
const AEROBIC_HR_HIGH_RATIO = 0.79;
const FALLBACK_HR_RANGE = { low: 120, high: 152 };

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
      left join workout_analysis wa on wa.workout_id = w.id
      where w.user_id = $1
        and w.start_date >= date_trunc('month', now()) - make_interval(months => $2::int - 1)
        and coalesce(wc.corrected_average_heartrate, w.average_heartrate) between $3 and $4
        and coalesce(wc.corrected_distance_meters, w.distance_meters) >= 3000
        and coalesce(wc.corrected_average_speed, w.average_speed) > 0
        -- сбой GPS не должен утаскивать тренд: без исправленной скорости
        -- доверяем только тренировкам с надёжным GPS-стримом
        and (wc.corrected_average_speed is not null or wa.gps_quality_status = 'reliable')
      group by 1
      order by 1 asc
    `,
    [userId, PACE_MONTHS, hrRange.low, hrRange.high]
  );
  return rows;
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
  const [weekly, aerobicPace, loadWeekly] = await Promise.all([
    getWeeklyDistance(userId),
    getAerobicPace(userId, hrRange),
    getWeeklyLoad(userId)
  ]);
  return { weekly, aerobicPace, aerobicHrRange: hrRange, loadWeekly };
}
