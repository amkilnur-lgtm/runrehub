import { pool } from "./db.js";
import { getFitnessSummaries } from "./fitness.js";
import { getAthleteZones, getWorkoutZoneSeconds } from "./hr-zones.js";

// Тепловая карта группы (client/DESIGN.md): спортсмены × периоды.
// Уровни: эта неделя по дням · 10 недель · 6 периодов по 4 недели · 6 месяцев.
export type HeatmapLevel = "days" | "weeks" | "blocks" | "months";

// Границы периодов уровня: [начало, конец) в UTC, как остальная статистика (date_trunc)
function periodsSql(level: HeatmapLevel) {
  switch (level) {
    case "days":
      return `select gs as start, gs + interval '1 day' as finish
              from generate_series(date_trunc('week', now()), date_trunc('week', now()) + interval '6 days', interval '1 day') gs`;
    case "weeks":
      return `select gs as start, gs + interval '1 week' as finish
              from generate_series(date_trunc('week', now()) - interval '9 weeks', date_trunc('week', now()), interval '1 week') gs`;
    case "blocks":
      return `select gs as start, gs + interval '4 weeks' as finish
              from generate_series(date_trunc('week', now()) - interval '23 weeks', date_trunc('week', now()) - interval '3 weeks', interval '4 weeks') gs`;
    case "months":
      return `select gs as start, gs + interval '1 month' as finish
              from generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') gs`;
  }
}

export type HeatmapCell = {
  distance_meters: number;
  elevation_gain: number;
  moving_time_seconds: number;
  workout_count: number;
  zone_seconds: number[];
  // для 4 недель и месяцев — км в неделю в среднем (периоды разной длины сравниваются честно)
  weekly_distance_meters: number | null;
};

export async function getGroupHeatmap(coachId: number, level: HeatmapLevel) {
  const periodsResult = await pool.query(`${periodsSql(level)} order by start`);
  const periods = periodsResult.rows.map((row) => ({ start: new Date(row.start), finish: new Date(row.finish) }));
  const from = periods[0]!.start;
  const to = periods[periods.length - 1]!.finish;

  const athletesResult = await pool.query(
    `
      select u.id, u.full_name, u.avatar_url, u.created_at,
             (select max(start_date) from workouts w where w.user_id = u.id) as last_workout_at
      from users u
      where u.role = 'athlete' and u.coach_id = $1
      order by u.full_name asc
    `,
    [coachId]
  );
  const athleteIds = athletesResult.rows.map((row) => Number(row.id));

  const workoutsResult = await pool.query(
    `
      select w.id, w.user_id, w.start_date,
             coalesce(wc.corrected_distance_meters, w.distance_meters)::float8 as distance_meters,
             coalesce(wc.corrected_elevation_gain, w.elevation_gain, 0)::float8 as elevation_gain,
             coalesce(wc.corrected_moving_time_seconds, w.moving_time_seconds, 0)::float8 as moving_time_seconds
      from workouts w
      left join workout_corrections wc on wc.workout_id = w.id
      where w.user_id = any($1::int[]) and w.start_date >= $2 and w.start_date < $3
    `,
    [athleteIds, from, to]
  );
  // время в 5 личных зонах пульса (hr-zones.ts)
  const zonesById = await getWorkoutZoneSeconds(workoutsResult.rows.map((row) => Number(row.id)));
  const athleteZones = await getAthleteZones(athleteIds);

  const now = Date.now();
  const empty = (): HeatmapCell => ({
    distance_meters: 0,
    elevation_gain: 0,
    moving_time_seconds: 0,
    workout_count: 0,
    zone_seconds: [0, 0, 0, 0, 0],
    weekly_distance_meters: null
  });
  const cells = new Map<number, HeatmapCell[]>(athleteIds.map((id) => [id, periods.map(empty)]));
  for (const row of workoutsResult.rows) {
    const at = new Date(row.start_date).getTime();
    const index = periods.findIndex((period) => at >= period.start.getTime() && at < period.finish.getTime());
    const cell = index >= 0 ? cells.get(Number(row.user_id))?.[index] : undefined;
    if (!cell) continue;
    cell.distance_meters += Number(row.distance_meters) || 0;
    cell.elevation_gain += Number(row.elevation_gain) || 0;
    cell.moving_time_seconds += Number(row.moving_time_seconds) || 0;
    cell.workout_count += 1;
    const zones = zonesById.get(Number(row.id)) ?? [0, 0, 0, 0, 0];
    zones.forEach((value, zone) => (cell.zone_seconds[zone]! += value));
  }
  if (level === "blocks" || level === "months") {
    for (const list of cells.values()) {
      list.forEach((cell, index) => {
        const period = periods[index]!;
        // идущий период — по прошедшим дням, иначе он всегда выглядит «слабым»
        const end = Math.min(period.finish.getTime(), now);
        const weeks = Math.max((end - period.start.getTime()) / (7 * 86_400_000), 1);
        cell.weekly_distance_meters = cell.distance_meters / weeks;
      });
    }
  }

  const fitness = await getFitnessSummaries(athleteIds);
  return {
    level,
    periods: periods.map((period) => ({ start: period.start.toISOString(), finish: period.finish.toISOString() })),
    athletes: athletesResult.rows.map((row) => {
      const id = Number(row.id);
      const summary = fitness.get(id) ?? null;
      return {
        id,
        full_name: row.full_name,
        avatar_url: row.avatar_url,
        member_since: row.created_at,
        last_workout_at: row.last_workout_at,
        cells: cells.get(id) ?? [],
        hr_zones: athleteZones.get(id) ?? null,
        freshness: summary ? { tsb: summary.tsb, zone: summary.zone } : null
      };
    })
  };
}
