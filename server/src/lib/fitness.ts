import { pool } from "./db.js";

// Форма / Усталость / Свежесть — как Performance Management Chart в TrainingPeaks.
// Нагрузка дня — сумма workout_analysis.training_load (минуты в пульсовых зонах × вес зоны).
// Форма (CTL) — экспоненциальное среднее за 42 дня, Усталость (ATL) — за 7 дней,
// Свежесть (TSB) — вчерашняя форма минус вчерашняя усталость (как в TP: утро дня до тренировки).
export const CTL_DAYS = 42;
export const ATL_DAYS = 7;
// Глубина истории для разгона средних: CTL «вспоминает» ~3 своих периода
const HISTORY_DAYS = 180;

export type FreshnessZone = "fresh" | "neutral" | "productive" | "overload";

export type FitnessPoint = { date: string; load: number; ctl: number; atl: number; tsb: number };

export type FitnessSummary = {
  ctl: number;
  atl: number;
  tsb: number;
  // прирост формы за 7 дней; больше +6 — риск
  ramp7: number;
  zone: FreshnessZone;
};

export function freshnessZone(tsb: number): FreshnessZone {
  if (tsb > 5) return "fresh";
  if (tsb < -30) return "overload";
  if (tsb <= -10) return "productive";
  return "neutral";
}

// loads — нагрузка по дням подряд, старый день первым
export function computeFitnessSeries(days: { date: string; load: number }[]): FitnessPoint[] {
  let ctl = 0;
  let atl = 0;
  return days.map(({ date, load }) => {
    const tsb = ctl - atl;
    ctl += (load - ctl) / CTL_DAYS;
    atl += (load - atl) / ATL_DAYS;
    return { date, load, ctl, atl, tsb };
  });
}

export function summarizeFitness(series: FitnessPoint[]): FitnessSummary | null {
  const last = series[series.length - 1];
  if (!last) return null;
  const weekAgo = series[series.length - 8] ?? series[0];
  const round = (value: number) => Math.round(value);
  return {
    ctl: round(last.ctl),
    atl: round(last.atl),
    tsb: round(last.tsb),
    ramp7: Math.round((last.ctl - weekAgo.ctl) * 10) / 10,
    zone: freshnessZone(last.tsb)
  };
}

// Дневные нагрузки за HISTORY_DAYS по каждому спортсмену (пустые дни — 0)
export async function getDailyLoads(userIds: number[], historyDays = HISTORY_DAYS) {
  const { rows } = await pool.query(
    `
      with days as (
        select generate_series(current_date - ($2::int - 1), current_date, interval '1 day')::date as day
      )
      select u.id as user_id, d.day::text as day,
             coalesce(sum(wa.training_load), 0)::float8 as load
      from unnest($1::int[]) as u(id)
      cross join days d
      left join workouts w on w.user_id = u.id and w.start_date::date = d.day
      left join workout_analysis wa on wa.workout_id = w.id
      group by u.id, d.day
      order by u.id, d.day
    `,
    [userIds, historyDays]
  );
  const byUser = new Map<number, { date: string; load: number }[]>();
  for (const row of rows) {
    const userId = Number(row.user_id);
    const list = byUser.get(userId) ?? [];
    list.push({ date: String(row.day), load: Number(row.load) });
    byUser.set(userId, list);
  }
  return byUser;
}

export async function getFitnessSummaries(userIds: number[]) {
  const loads = await getDailyLoads(userIds);
  const result = new Map<number, FitnessSummary | null>();
  for (const userId of userIds) {
    const series = computeFitnessSeries(loads.get(userId) ?? []);
    // нет ни одной нагрузки — состояние не показываем
    result.set(userId, series.some((point) => point.load > 0) ? summarizeFitness(series) : null);
  }
  return result;
}
