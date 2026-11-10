import { pool } from "./db.js";

// Зоны темпа по Дэниелсу от порогового темпа T (сек/км). Границы — доли T:
// Лёгкий медленнее 1,18·T · Марафонский 1,06–1,18 · Пороговый 0,97–1,06 ·
// Интервальный 0,91–0,97 · Повторный быстрее 0,91·T
export const PACE_ZONE_FACTORS = [1.18, 1.06, 0.97, 0.91];

export function paceZoneBounds(threshold: number) {
  return PACE_ZONE_FACTORS.map((factor) => Math.round(threshold * factor));
}

// VDOT по результату старта и пороговый темп (88% VDOT) — формулы Дэниелса–Гилберта
export function thresholdFromRace(distanceMeters: number, timeSeconds: number) {
  const minutes = timeSeconds / 60;
  if (distanceMeters < 3000 || minutes <= 0) return null;
  const velocity = distanceMeters / minutes; // м/мин
  const vo2 = -4.6 + 0.182258 * velocity + 0.000104 * velocity ** 2;
  const share = 0.8 + 0.1894393 * Math.exp(-0.012778 * minutes) + 0.2989558 * Math.exp(-0.1932605 * minutes);
  const vdot = vo2 / share;
  const target = 0.88 * vdot;
  const a = 0.000104;
  const b = 0.182258;
  const c = -4.6 - target;
  const thresholdVelocity = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  return thresholdVelocity > 0 ? Math.round((1000 / thresholdVelocity) * 60) : null;
}

export type Threshold = {
  pace_seconds_per_km: number;
  source: "manual" | "race";
  race?: { name: string; race_date: string; distance_meters: number; official_time_seconds: number };
} | null;

// Ручной порог главнее; иначе — оценка по самому сильному старту за 12 месяцев (5 км и длиннее)
export async function getThreshold(athleteId: number): Promise<Threshold> {
  const manual = await pool.query(`select pace_seconds_per_km from athlete_thresholds where athlete_id = $1`, [athleteId]);
  if (manual.rows[0]) return { pace_seconds_per_km: Number(manual.rows[0].pace_seconds_per_km), source: "manual" };
  const { rows } = await pool.query(
    `
      select name, race_date::text as race_date, distance_meters, official_time_seconds
      from race_results
      where user_id = $1 and status = 'finished' and official_time_seconds > 0
        and distance_meters >= 4900 and race_date >= current_date - 365
    `,
    [athleteId]
  );
  let best: Threshold = null;
  for (const row of rows) {
    const pace = thresholdFromRace(Number(row.distance_meters), Number(row.official_time_seconds));
    if (pace && (!best || pace < best.pace_seconds_per_km)) {
      best = {
        pace_seconds_per_km: pace,
        source: "race",
        race: {
          name: String(row.name),
          race_date: String(row.race_date),
          distance_meters: Number(row.distance_meters),
          official_time_seconds: Number(row.official_time_seconds)
        }
      };
    }
  }
  return best;
}

// Время в зонах темпа по потоку: темп каждой точки — по окну ~20 с вперёд (гасит шум GPS),
// остановки (дистанция не растёт) и нереальный темп не считаются
export function paceZoneSecondsFromStream(distance: number[], time: number[], threshold: number) {
  const bounds = paceZoneBounds(threshold);
  const seconds = [0, 0, 0, 0, 0];
  const size = Math.min(distance.length, time.length);
  let ahead = 0;
  for (let index = 1; index < size; index += 1) {
    const dt = Number(time[index]) - Number(time[index - 1]);
    const dd = Number(distance[index]) - Number(distance[index - 1]);
    if (!(dt > 0 && dt <= 10) || !(dd > 0.2)) continue;
    if (ahead < index) ahead = index;
    while (ahead < size - 1 && Number(time[ahead]) - Number(time[index]) < 20) ahead += 1;
    const spanTime = Number(time[ahead]) - Number(time[index - 1]);
    const spanDistance = Number(distance[ahead]) - Number(distance[index - 1]);
    if (!(spanDistance > 5)) continue;
    const pace = (spanTime / spanDistance) * 1000;
    if (pace < 100 || pace > 1200) continue;
    const zone = pace > bounds[0]! ? 0 : pace > bounds[1]! ? 1 : pace > bounds[2]! ? 2 : pace > bounds[3]! ? 3 : 4;
    seconds[zone] += dt;
  }
  return seconds.map(Math.round);
}

// Сумма зон по пробежкам; пересчитываем те, что считались по другому порогу
export async function paceZonesFor(workoutIds: number[], threshold: number) {
  if (!workoutIds.length) return [0, 0, 0, 0, 0];
  const stale = await pool.query(
    `
      select w.id, s.distance_stream, s.time_stream
      from unnest($1::int[]) ids(id)
      join workouts w on w.id = ids.id
      left join workout_pace_zones z on z.workout_id = w.id
      left join workout_streams s on s.workout_id = w.id
      where z.workout_id is null or z.threshold_seconds <> $2
    `,
    [workoutIds, threshold]
  );
  for (const row of stale.rows) {
    const zones = paceZoneSecondsFromStream(row.distance_stream ?? [], row.time_stream ?? [], threshold);
    await pool.query(
      `
        insert into workout_pace_zones (workout_id, threshold_seconds, z1_seconds, z2_seconds, z3_seconds, z4_seconds, z5_seconds)
        values ($1, $2, $3, $4, $5, $6, $7)
        on conflict (workout_id) do update set threshold_seconds = excluded.threshold_seconds,
          z1_seconds = excluded.z1_seconds, z2_seconds = excluded.z2_seconds, z3_seconds = excluded.z3_seconds,
          z4_seconds = excluded.z4_seconds, z5_seconds = excluded.z5_seconds, computed_at = now()
      `,
      [row.id, threshold, ...zones]
    );
  }
  const { rows } = await pool.query(
    `select coalesce(sum(z1_seconds),0) a, coalesce(sum(z2_seconds),0) b, coalesce(sum(z3_seconds),0) c,
            coalesce(sum(z4_seconds),0) d, coalesce(sum(z5_seconds),0) e
     from workout_pace_zones where workout_id = any($1::int[])`,
    [workoutIds]
  );
  return [rows[0].a, rows[0].b, rows[0].c, rows[0].d, rows[0].e].map(Number);
}
