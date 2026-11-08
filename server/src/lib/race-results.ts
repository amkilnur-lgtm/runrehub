import { z } from "zod";

import { pool } from "./db.js";

// Стандартные дистанции: результат в пределах допуска засчитывается в рекорд этой
// дистанции (трассы мерят по-разному, полумарафон — это и 21 097, и 21 100 м)
export const STANDARD_DISTANCES = [
  { meters: 5000, label: "5 км" },
  { meters: 10000, label: "10 км" },
  { meters: 21097, label: "21,1 км" },
  { meters: 42195, label: "42,2 км" }
] as const;
const DISTANCE_TOLERANCE = 0.02;

export function standardDistanceFor(meters: number) {
  return STANDARD_DISTANCES.find((item) => Math.abs(meters - item.meters) / item.meters <= DISTANCE_TOLERANCE) ?? null;
}

export const raceResultSchema = z
  .object({
    status: z.enum(["planned", "finished"]),
    raceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    name: z.string().trim().min(1).max(120),
    city: z.string().trim().max(80).nullish(),
    distanceMeters: z.number().int().min(100).max(400_000),
    officialTimeSeconds: z.number().int().positive().max(7 * 24 * 3600).nullish(),
    goalTimeSeconds: z.number().int().positive().max(7 * 24 * 3600).nullish(),
    placeOverall: z.number().int().positive().nullish(),
    participants: z.number().int().positive().nullish(),
    placeCategory: z.number().int().positive().nullish(),
    protocolUrl: z.string().trim().url().max(500).refine((url) => /^https?:\/\//i.test(url)).nullish(),
    note: z.string().trim().max(500).nullish(),
    workoutId: z.number().int().positive().nullish()
  })
  .refine((value) => value.status === "planned" || Boolean(value.officialTimeSeconds), {
    message: "Укажите время по протоколу",
    path: ["officialTimeSeconds"]
  });

export type RaceResultInput = z.infer<typeof raceResultSchema>;

export type RaceResultRow = {
  id: number;
  user_id: number;
  status: "planned" | "finished";
  race_date: string;
  name: string;
  city: string | null;
  distance_meters: number;
  official_time_seconds: number | null;
  goal_time_seconds: number | null;
  place_overall: number | null;
  participants: number | null;
  place_category: number | null;
  protocol_url: string | null;
  note: string | null;
  workout_id: number | null;
};

export type PersonalBest = {
  distanceMeters: number;
  label: string;
  result: RaceResultRow | null;
  // на сколько секунд быстрее предыдущего рекорда (null — первый результат)
  improvementSeconds: number | null;
};

// Рекорды по стандартным дистанциям и пометка «рекорд на момент старта»
export function computePersonalBests(results: RaceResultRow[]) {
  const finished = results
    .filter((row) => row.status === "finished" && row.official_time_seconds)
    .sort((a, b) => a.race_date.localeCompare(b.race_date) || a.id - b.id);

  const recordIds = new Set<number>();
  const bests: PersonalBest[] = STANDARD_DISTANCES.map((distance) => {
    let best: RaceResultRow | null = null;
    let previousBestTime: number | null = null;
    let improvement: number | null = null;
    for (const row of finished) {
      if (standardDistanceFor(row.distance_meters)?.meters !== distance.meters) continue;
      if (!best || row.official_time_seconds! < best.official_time_seconds!) {
        previousBestTime = best?.official_time_seconds ?? null;
        improvement = previousBestTime === null ? null : previousBestTime - row.official_time_seconds!;
        best = row;
        recordIds.add(row.id);
      }
    }
    return { distanceMeters: distance.meters, label: distance.label, result: best, improvementSeconds: improvement };
  });
  return { bests, recordIds };
}

function normalizeRow(row: Record<string, unknown>): RaceResultRow {
  const date = row.race_date as Date | string;
  return {
    ...(row as unknown as RaceResultRow),
    race_date: typeof date === "string" ? date.slice(0, 10) : formatDateOnly(date)
  };
}

// pg отдаёт date как Date в локальной зоне сервера — собираем YYYY-MM-DD без сдвига в UTC
function formatDateOnly(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export async function getAthleteResults(athleteId: number) {
  const { rows } = await pool.query(
    `select * from race_results where user_id = $1 order by race_date desc, id desc`,
    [athleteId]
  );
  const results = rows.map(normalizeRow);
  const { bests } = computePersonalBests(results);
  // метка «рекорд» — только у действующих рекордов, иначе ей помечен почти каждый старт
  const currentRecordIds = new Set(bests.map((best) => best.result?.id).filter((id): id is number => id !== undefined));
  return {
    results: results.map((row) => ({ ...row, is_record: currentRecordIds.has(row.id) })),
    personalBests: bests
  };
}

export async function getGroupUpcomingStarts(coachId: number, days = 30) {
  const { rows } = await pool.query(
    `
      select r.id, r.user_id, r.name, r.race_date, r.distance_meters, r.goal_time_seconds, r.city,
             u.full_name as athlete_name, u.avatar_url as athlete_avatar_url
      from race_results r
      join users u on u.id = r.user_id
      where u.coach_id = $1 and r.status = 'planned'
        and r.race_date >= current_date and r.race_date <= current_date + $2::int
      order by r.race_date asc, u.full_name asc
      limit 12
    `,
    [coachId, days]
  );
  return rows.map(normalizeRow);
}

export async function insertRaceResult(athleteId: number, authorId: number, input: RaceResultInput) {
  const { rows } = await pool.query(
    `
      insert into race_results (
        user_id, status, race_date, name, city, distance_meters, official_time_seconds, goal_time_seconds,
        place_overall, participants, place_category, protocol_url, note, workout_id, created_by_user_id
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
              (select id from workouts where id = $14 and user_id = $1), $15)
      returning *
    `,
    [athleteId, ...inputValues(input), authorId]
  );
  return normalizeRow(rows[0]);
}

export async function updateRaceResult(resultId: number, input: RaceResultInput) {
  const { rows } = await pool.query(
    `
      update race_results r set
        status = $2, race_date = $3, name = $4, city = $5, distance_meters = $6, official_time_seconds = $7,
        goal_time_seconds = $8, place_overall = $9, participants = $10, place_category = $11,
        protocol_url = $12, note = $13,
        workout_id = (select id from workouts where id = $14 and user_id = r.user_id),
        updated_at = now()
      where r.id = $1
      returning *
    `,
    [resultId, ...inputValues(input)]
  );
  return rows[0] ? normalizeRow(rows[0]) : null;
}

function inputValues(input: RaceResultInput) {
  const finished = input.status === "finished";
  return [
    input.status,
    input.raceDate,
    input.name,
    input.city || null,
    input.distanceMeters,
    finished ? input.officialTimeSeconds ?? null : null,
    input.goalTimeSeconds ?? null,
    finished ? input.placeOverall ?? null : null,
    finished ? input.participants ?? null : null,
    finished ? input.placeCategory ?? null : null,
    input.protocolUrl || null,
    input.note || null,
    input.workoutId ?? null
  ];
}

// Владелец результата — для проверки прав: атлет правит свои, тренер — своих атлетов
export async function getRaceResultOwner(resultId: number) {
  const { rows } = await pool.query(
    `select r.user_id, u.coach_id from race_results r join users u on u.id = r.user_id where r.id = $1`,
    [resultId]
  );
  return rows[0] ? { userId: Number(rows[0].user_id), coachId: rows[0].coach_id === null ? null : Number(rows[0].coach_id) } : null;
}

export async function deleteRaceResult(resultId: number) {
  await pool.query(`delete from race_results where id = $1`, [resultId]);
}

const RACE_NAME_PATTERN = /забег|старт|марафон|пробег|race|parkrun|\brun\b.*\d/i;
const RACE_HINT_TOLERANCE = 0.03;
// темп быстрее обычного хотя бы на 7% — похоже на работу «на результат»
const RACE_HINT_SPEEDUP = 1.07;

// «Похоже на старт»: дистанция около стандартной и либо название про забег,
// либо темп заметно быстрее обычного за последние 60 дней. Только подсказка
// спортсмену — рекорд по GPS не засчитываем
export async function detectRaceHint(workout: {
  id: number;
  user_id: number;
  name: string;
  distance_meters: number;
  average_speed: number | null;
}) {
  const distance = STANDARD_DISTANCES.find(
    (item) => Math.abs(workout.distance_meters - item.meters) / item.meters <= RACE_HINT_TOLERANCE
  );
  if (!distance) return null;

  const { rows } = await pool.query(
    `
      select
        exists (select 1 from race_results r where r.workout_id = $1) as already_linked,
        (
          select percentile_cont(0.5) within group (order by w.average_speed)
          from workouts w
          where w.user_id = $2 and w.id <> $1 and w.average_speed > 0
            and w.start_date > now() - interval '60 days'
        ) as usual_speed
    `,
    [workout.id, workout.user_id]
  );
  if (rows[0]?.already_linked) return null;

  const usual = rows[0]?.usual_speed === null ? null : Number(rows[0]?.usual_speed);
  const namedLikeRace = RACE_NAME_PATTERN.test(workout.name);
  const fasterThanUsual = Boolean(usual && workout.average_speed && workout.average_speed >= usual * RACE_HINT_SPEEDUP);
  return namedLikeRace || fasterThanUsual ? { distanceMeters: distance.meters, label: distance.label } : null;
}
