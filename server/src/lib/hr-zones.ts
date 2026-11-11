import { pool } from "./db.js";
import { decryptToken } from "./strava.js";

// Личные пульсовые зоны — 5 зон по Фрилу от порогового пульса (LTHR):
// Z1 до 85% · Z2 85–89% · Z3 90–94% · Z4 95–99% · Z5 от 100%.
// Источник: зоны бега из intervals.icu (там 7 зон Фрила; 5a–5c сводим в Z5),
// без них — LTHR ≈ 91% от оценки максимального пульса по истории, без истории — клубный LTHR 170.
export const FRIEL_FRACTIONS = [0.85, 0.9, 0.95, 1.0];
export const ZONE_NAMES = ["Восстановление", "Аэробная", "Темп", "Ниже порога", "Порог и выше"];
const DEFAULT_LTHR = 170;

export type AthleteZones = {
  // верхние границы Z1–Z4 включительно: пульс > bounds[i] — уже следующая зона
  bounds: [number, number, number, number];
  lthr: number;
  max_hr: number | null;
  source: "intervals" | "estimate" | "default";
};

function boundsFromLthr(lthr: number): [number, number, number, number] {
  return FRIEL_FRACTIONS.map((f) => Math.round(f * lthr) - 1) as [number, number, number, number];
}

export function zoneIndex(bpm: number, bounds: number[]) {
  let index = 0;
  while (index < 4 && bpm > bounds[index]!) index += 1;
  return index;
}

export function zoneKey(zones: AthleteZones) {
  return zones.bounds.join(",");
}

// время в 5 зонах по потокам пульса и времени; длинные дыры (паузы записи) не считаем
export function zoneSeconds5(heartrate: number[], time: number[], bounds: number[]) {
  const seconds = [0, 0, 0, 0, 0];
  const size = Math.min(heartrate.length, time.length);
  for (let i = 1; i < size; i += 1) {
    const dt = Number(time[i]) - Number(time[i - 1]);
    const bpm = Number(heartrate[i]);
    if (!(dt > 0 && dt <= 30) || !(bpm >= 60 && bpm <= 230)) continue;
    seconds[zoneIndex(bpm, bounds)] += dt;
  }
  return seconds.map(Math.round);
}

export async function getAthleteZones(userIds: number[]) {
  const map = new Map<number, AthleteZones>();
  if (!userIds.length) return map;
  const { rows } = await pool.query(
    `select u.id, u.hr_lthr, u.hr_max, u.hr_zone_bounds,
            (select percentile_cont(0.95) within group (order by w.max_heartrate) + 3
               from workouts w where w.user_id = u.id and w.max_heartrate between 120 and 230) as est_max
     from users u where u.id = any($1::int[])`,
    [userIds]
  );
  for (const row of rows) {
    const id = Number(row.id);
    const stored = Array.isArray(row.hr_zone_bounds) ? (row.hr_zone_bounds as number[]).map(Number) : null;
    if (row.hr_lthr && stored && stored.length >= 4) {
      map.set(id, { bounds: stored.slice(0, 4) as AthleteZones["bounds"], lthr: Number(row.hr_lthr), max_hr: row.hr_max ? Number(row.hr_max) : null, source: "intervals" });
    } else if (row.hr_lthr) {
      map.set(id, { bounds: boundsFromLthr(Number(row.hr_lthr)), lthr: Number(row.hr_lthr), max_hr: row.hr_max ? Number(row.hr_max) : null, source: "intervals" });
    } else if (Number(row.est_max) >= 150) {
      const max = Math.round(Number(row.est_max));
      const lthr = Math.round(max * 0.91);
      map.set(id, { bounds: boundsFromLthr(lthr), lthr, max_hr: max, source: "estimate" });
    } else {
      map.set(id, { bounds: boundsFromLthr(DEFAULT_LTHR), lthr: DEFAULT_LTHR, max_hr: null, source: "default" });
    }
  }
  return map;
}

// Зоны бега из intervals.icu — раз в сутки на спортсмена (вызывается из синхронизации)
export async function refreshIntervalsHrZones(force = false) {
  const { rows } = await pool.query(
    `select u.id, ic.icu_athlete_id, ic.api_key from intervals_connections ic join users u on u.id = ic.user_id
     where $1 or u.hr_zones_updated_at is null or u.hr_zones_updated_at < now() - interval '1 day'`,
    [force]
  );
  for (const row of rows) {
    try {
      const res = await fetch(`https://intervals.icu/api/v1/athlete/${encodeURIComponent(row.icu_athlete_id)}`, {
        headers: { Authorization: "Basic " + Buffer.from("API_KEY:" + decryptToken(row.api_key)).toString("base64") }
      });
      if (!res.ok) continue;
      const body = (await res.json()) as { sportSettings?: Array<{ types?: string[]; lthr?: number | null; max_hr?: number | null; hr_zones?: number[] | null }> };
      const run = (body.sportSettings ?? []).find((s) => (s.types ?? []).includes("Run"));
      const lthr = run?.lthr && run.lthr >= 100 && run.lthr <= 220 ? Math.round(run.lthr) : null;
      // 7 зон Фрила в intervals.icu → первые 4 верхние границы = наши Z1–Z4
      const zones = Array.isArray(run?.hr_zones) && run!.hr_zones!.length >= 5 ? run!.hr_zones!.slice(0, 4).map(Math.round) : null;
      await pool.query(
        `update users set hr_lthr = $2, hr_max = $3, hr_zone_bounds = $4::jsonb, hr_zones_updated_at = now() where id = $1`,
        [row.id, lthr, run?.max_hr ? Math.round(run.max_hr) : null, zones ? JSON.stringify(zones) : null]
      );
    } catch {
      // нет сети или ключ отозван — попробуем при следующей синхронизации
    }
  }
}

// Время в 5 личных зонах по каждой пробежке. Считается один раз и хранится в workout_hr_zones
// вместе с границами (zone_key) — если порог спортсмена сменился, пробежка пересчитывается.
export async function getWorkoutZoneSeconds(workoutIds: number[]) {
  const result = new Map<number, number[]>();
  if (!workoutIds.length) return result;
  const owners = await pool.query(
    `select w.id, w.user_id, z.zone_key, z.z1_seconds, z.z2_seconds, z.z3_seconds, z.z4_seconds, z.z5_seconds
     from workouts w left join workout_hr_zones z on z.workout_id = w.id where w.id = any($1::int[])`,
    [workoutIds]
  );
  const zones = await getAthleteZones([...new Set(owners.rows.map((row) => Number(row.user_id)))]);
  const stale: Array<{ id: number; bounds: number[]; key: string }> = [];
  for (const row of owners.rows) {
    const athlete = zones.get(Number(row.user_id));
    if (!athlete) continue;
    const key = zoneKey(athlete);
    if (row.zone_key === key) {
      result.set(Number(row.id), [row.z1_seconds, row.z2_seconds, row.z3_seconds, row.z4_seconds, row.z5_seconds].map(Number));
    } else {
      stale.push({ id: Number(row.id), bounds: athlete.bounds, key });
    }
  }
  for (let i = 0; i < stale.length; i += 50) {
    const chunk = stale.slice(i, i + 50);
    const streams = await pool.query(
      `select workout_id, heartrate_stream, time_stream from workout_streams where workout_id = any($1::int[])`,
      [chunk.map((item) => item.id)]
    );
    const byId = new Map(streams.rows.map((row) => [Number(row.workout_id), row]));
    for (const item of chunk) {
      const stream = byId.get(item.id);
      const hr = Array.isArray(stream?.heartrate_stream) ? stream.heartrate_stream : [];
      const time = Array.isArray(stream?.time_stream) ? stream.time_stream : [];
      const seconds = zoneSeconds5(hr, time, item.bounds);
      await pool.query(
        `insert into workout_hr_zones (workout_id, z1_seconds, z2_seconds, z3_seconds, z4_seconds, z5_seconds, zone_key, computed_at)
         values ($1, $2, $3, $4, $5, $6, $7, now())
         on conflict (workout_id) do update set z1_seconds = excluded.z1_seconds, z2_seconds = excluded.z2_seconds,
           z3_seconds = excluded.z3_seconds, z4_seconds = excluded.z4_seconds, z5_seconds = excluded.z5_seconds,
           zone_key = excluded.zone_key, computed_at = now()`,
        [item.id, ...seconds, item.key]
      );
      result.set(item.id, seconds);
    }
  }
  return result;
}
