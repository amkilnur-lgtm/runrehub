import { FastifyBaseLogger } from "fastify";

import { pool } from "./db.js";
import { addStravaEvent } from "./strava-events.js";
import { enqueueNewWorkoutTelegramNotification } from "./telegram-notifications.js";
import {
  encryptToken,
  decryptToken,
  getStoredActivityStreams,
  saveActivityStreams,
  applyLapElevationChanges,
  parseNumberStream,
  parseLatLngStream,
  type ActivityStreams
} from "./strava.js";
import { analyzeWorkout } from "./workout-analysis.js";
import {
  buildAthleteCadenceProfile,
  buildGpsFixPreview,
  getActiveWorkoutCorrection,
  upsertWorkoutCorrection
} from "./workout-gps-fix.js";
import { config } from "../config.js";

// Средняя скорость выше этой (≈3:02/км) для беговой тренировки нереальна —
// признак GPS-сбоя с завышением дистанции. Дешёвый пред-фильтр перед авто-фиксом.
const AUTOFIX_SUSPECT_SPEED_MPS = 5.5;

const INTERVALS_API_BASE = "https://intervals.icu/api/v1";
const INTERVALS_SYNC_LOCK_NAMESPACE = 4272;
const SYNC_LOOKBACK_MS = 36 * 60 * 60 * 1000;
const FIRST_SYNC_DAYS = 90;
const DEEP_SYNC_DAYS = 30;
const DEEP_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
// Вся история до этой даты уже в БД (Strava-архив по 30.06.2026 включительно).
// Раньше неё не ходим ни первым, ни глубоким синком: у активностей intervals.icu,
// залитых не через Strava, нет strava_id — дедупу не за что зацепиться, и старый
// период импортируется дублями (случилось у Алёны и Кирилла 13.07.2026).
const SYNC_FLOOR = new Date("2026-07-01T00:00:00Z");
const RUN_TYPES = new Set(["run", "trailrun", "virtualrun"]);

export type IntervalsActivity = {
  id: string;
  strava_id: string | null;
  type: string | null;
  name: string | null;
  start_date: string;
  distance: number | null;
  moving_time: number | null;
  elapsed_time: number | null;
  total_elevation_gain: number | null;
  average_speed: number | null;
  average_heartrate: number | null;
  max_heartrate: number | null;
  // считаются intervals.icu из данных часов, профиль атлета не нужен
  gap: number | null;
  average_cadence: number | null;
  average_stride: number | null;
  icu_training_load: number | null;
  device_name: string | null;
};

type IntervalsLap = {
  id: number | null;
  label: string | null;
  distance: number | null;
  elapsed_time: number | null;
  average_speed: number | null;
  average_heartrate: number | null;
  total_elevation_gain: number | null;
  start_index: number | null;
  end_index: number | null;
};

type StreamEntry = {
  type: string;
  data: unknown[] | null;
  // для latlng intervals.icu кладет широты в data, долготы в data2
  data2?: unknown[] | null;
};

// В паузах записи (и на старте, пока часы не поймали каденс/пульс) intervals.icu
// кладёт в поток null. Строгий parseNumberStream выбрасывал ВЕСЬ стрим из-за одного
// null — так терялся каденс у COROS (нулей много в начале). Заменяем null→0,
// сохраняя длину/выравнивание по индексам; downstream трактует 0 как «нет значения».
function parseLenientNumberStream(values: unknown[] | undefined) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.map((value) => (typeof value === "number" && Number.isFinite(value) ? value : 0));
}

function zipLatLng(entry: StreamEntry | undefined) {
  const lats = entry?.data;
  const lngs = entry?.data2;
  if (!Array.isArray(lats) || !Array.isArray(lngs) || lats.length !== lngs.length) {
    return [] as Array<[number, number]>;
  }

  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < lats.length; i += 1) {
    const lat = lats[i];
    const lng = lngs[i];
    if (typeof lat === "number" && typeof lng === "number") {
      pairs.push([lat, lng]);
    }
  }
  return pairs;
}

export type IntervalsSyncResult =
  | { synced: false; reason: "already_running" | "not_connected" }
  | { synced: true; imported: number; startedAt: string; finishedAt: string };

function buildAuthHeader(apiKey: string) {
  return `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString("base64")}`;
}

export function normalizeIcuAthleteId(raw: string) {
  const trimmed = raw.trim();
  return /^\d+$/.test(trimmed) ? `i${trimmed}` : trimmed;
}

async function intervalsFetch(apiKey: string, path: string) {
  const response = await fetch(`${INTERVALS_API_BASE}${path}`, {
    headers: { Authorization: buildAuthHeader(apiKey) }
  });
  return response;
}

export async function verifyIntervalsCredentials(icuAthleteId: string, apiKey: string) {
  const response = await intervalsFetch(apiKey, `/athlete/${encodeURIComponent(icuAthleteId)}`);
  if (!response.ok) {
    const body = (await response.text()).slice(0, 300);
    return {
      ok: false as const,
      status: response.status,
      message: `INTERVALS_AUTH_FAILED status=${response.status} body=${body}`
    };
  }
  const athlete = (await response.json()) as { id?: string; name?: string };
  return { ok: true as const, athleteName: athlete.name ?? null };
}

export async function connectIntervalsAccount(userId: number, icuAthleteId: string, apiKey: string) {
  await pool.query(
    `
      insert into intervals_connections (user_id, icu_athlete_id, api_key, connected_at)
      values ($1, $2, $3, now())
      on conflict (user_id) do update
      set icu_athlete_id = excluded.icu_athlete_id,
          api_key = excluded.api_key,
          connected_at = now(),
          last_synced_at = null,
          last_deep_synced_at = null,
          sync_started_at = null,
          last_sync_error = null
    `,
    [userId, icuAthleteId, encryptToken(apiKey)]
  );
}

export async function disconnectIntervalsAccount(userId: number) {
  await pool.query(`delete from intervals_connections where user_id = $1`, [userId]);
}

// Логин-пароль от аккаунта intervals.icu (не API-ключ) — нужны, чтобы дёрнуть
// activities-sync (форсировать подтяжку из COROS). Хранятся зашифрованными.
export async function setIntervalsAccountCredentials(userId: number, email: string, password: string) {
  await pool.query(
    `update intervals_connections set icu_email = $2, icu_password = $3 where user_id = $1`,
    [userId, email, encryptToken(password)]
  );
}

export type IntervalsForceResult =
  | { forced: true }
  | { forced: false; reason: "no_credentials" | "login_failed" | "sync_failed"; detail?: string };

// Воспроизводит то, что делает сайт intervals.icu при заходе: логинится
// (POST /api/login, multipart email+password) и дёргает activities-sync,
// который заставляет intervals.icu подтянуть свежие тренировки из COROS.
export async function forceIntervalsAccountRefresh(userId: number): Promise<IntervalsForceResult> {
  const { rows } = await pool.query(
    `select icu_athlete_id, icu_email, icu_password from intervals_connections where user_id = $1`,
    [userId]
  );
  const conn = rows[0];
  if (!conn?.icu_email || !conn?.icu_password) {
    return { forced: false, reason: "no_credentials" };
  }

  const password = decryptToken(conn.icu_password);
  const form = new FormData();
  form.append("email", conn.icu_email);
  form.append("password", password);

  const loginResponse = await fetch("https://intervals.icu/api/login?deviceClass=desktop", {
    method: "POST",
    body: form
  });
  if (!loginResponse.ok) {
    return { forced: false, reason: "login_failed", detail: `status=${loginResponse.status}` };
  }

  // куки сессии из Set-Cookie (athlete_id + locale)
  const setCookies =
    typeof loginResponse.headers.getSetCookie === "function"
      ? loginResponse.headers.getSetCookie()
      : [loginResponse.headers.get("set-cookie") ?? ""].filter(Boolean);
  const cookieHeader = setCookies.map((c) => c.split(";")[0]).join("; ");
  if (!cookieHeader) {
    return { forced: false, reason: "login_failed", detail: "no session cookie" };
  }

  const syncResponse = await fetch(
    `https://intervals.icu/api/athlete/${encodeURIComponent(conn.icu_athlete_id)}/activities-sync`,
    { method: "POST", headers: { Cookie: cookieHeader } }
  );
  if (!syncResponse.ok) {
    return { forced: false, reason: "sync_failed", detail: `status=${syncResponse.status}` };
  }

  return { forced: true };
}

async function getConnection(userId: number) {
  const { rows } = await pool.query(
    `
      select user_id, icu_athlete_id, api_key, connected_at, last_synced_at, last_deep_synced_at
      from intervals_connections
      where user_id = $1
    `,
    [userId]
  );
  return rows[0] ?? null;
}

function isRunningActivity(activity: IntervalsActivity) {
  return RUN_TYPES.has((activity.type ?? "").toLowerCase());
}

async function fetchActivityStreams(apiKey: string, activityId: string) {
  const types = "time,distance,heartrate,cadence,velocity_smooth,altitude,fixed_altitude,latlng,watts";
  const response = await intervalsFetch(
    apiKey,
    `/activity/${encodeURIComponent(activityId)}/streams?types=${types}`
  );
  if (!response.ok) {
    return null;
  }

  const entries = (await response.json()) as StreamEntry[];
  const byType = new Map(entries.map((entry) => [entry.type, entry]));
  const numberData = (type: string) => byType.get(type)?.data ?? undefined;
  const latlngEntry = byType.get("latlng");

  return {
    distance: parseNumberStream(numberData("distance")),
    time: parseNumberStream(numberData("time")),
    // лояльные (null→0, длина сохранена): в этих потоках COROS часто есть null
    // на старте/в паузах, а строгий парсер выбрасывал весь массив
    heartrate: parseLenientNumberStream(numberData("heartrate")),
    cadence: parseLenientNumberStream(numberData("cadence")),
    altitude: parseNumberStream(numberData("fixed_altitude") ?? numberData("altitude")),
    velocity_smooth: parseLenientNumberStream(numberData("velocity_smooth")),
    latlng:
      latlngEntry?.data2 != null ? zipLatLng(latlngEntry) : parseLatLngStream(latlngEntry?.data ?? undefined),
    watts: parseLenientNumberStream(numberData("watts"))
  } satisfies ActivityStreams;
}

// Хвост автокруга (последние метры после целых километров: 3 м / 1 с) — не круг.
// Порог не трогает осознанно короткие круги: ускорения (~100 м) и стоячие паузы отдыха (60+ с)
function isRemainderLap(lap: IntervalsLap) {
  return (lap.distance ?? 0) < 30 && (lap.elapsed_time ?? 0) < 15;
}

async function fetchActivityLaps(apiKey: string, activityId: string) {
  const response = await intervalsFetch(
    apiKey,
    `/activity/${encodeURIComponent(activityId)}/intervals`
  );
  if (!response.ok) {
    return [];
  }
  const payload = (await response.json()) as { icu_intervals?: IntervalsLap[] };
  return (payload.icu_intervals ?? []).filter((lap) => !isRemainderLap(lap));
}

async function syncSingleIntervalsActivity(userId: number, apiKey: string, activity: IntervalsActivity) {
  // Тренировка могла уже приехать из Strava раньше — не создаем дубль
  if (activity.strava_id) {
    const { rows } = await pool.query(
      `select id from workouts where user_id = $1 and strava_activity_id = $2`,
      [userId, activity.strava_id]
    );
    if (rows[0]) {
      return { workoutId: rows[0].id as number, isNewWorkout: false, deduped: true };
    }
  }

  const client = await pool.connect();
  let workoutId: number;
  let isNewWorkout = false;

  try {
    await client.query("BEGIN");

    const workoutResult = await client.query(
      `
        insert into workouts (
          user_id,
          source,
          source_activity_id,
          name,
          strava_name,
          sport_type,
          start_date,
          distance_meters,
          moving_time_seconds,
          elapsed_time_seconds,
          elevation_gain,
          average_speed,
          average_heartrate,
          max_heartrate,
          grade_adjusted_speed,
          average_cadence,
          average_stride,
          training_load,
          device_name
        )
        values ($1,'intervals',$2,$3,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        on conflict (source, source_activity_id) do update
        set name = coalesce(workouts.custom_name, excluded.strava_name),
            strava_name = excluded.strava_name,
            sport_type = excluded.sport_type,
            start_date = excluded.start_date,
            distance_meters = excluded.distance_meters,
            moving_time_seconds = excluded.moving_time_seconds,
            elapsed_time_seconds = excluded.elapsed_time_seconds,
            elevation_gain = excluded.elevation_gain,
            average_speed = excluded.average_speed,
            average_heartrate = excluded.average_heartrate,
            max_heartrate = excluded.max_heartrate,
            grade_adjusted_speed = excluded.grade_adjusted_speed,
            average_cadence = excluded.average_cadence,
            average_stride = excluded.average_stride,
            training_load = excluded.training_load,
            device_name = excluded.device_name
        returning id, (xmax = 0) as inserted
      `,
      [
        userId,
        activity.id,
        activity.name ?? "Тренировка",
        activity.type ?? "Run",
        activity.start_date,
        activity.distance ?? 0,
        activity.moving_time ?? 0,
        activity.elapsed_time ?? 0,
        activity.total_elevation_gain ?? 0,
        activity.average_speed,
        activity.average_heartrate ?? null,
        activity.max_heartrate ?? null,
        activity.gap ?? null,
        activity.average_cadence ?? null,
        activity.average_stride ?? null,
        activity.icu_training_load ?? null,
        activity.device_name ?? null
      ]
    );

    workoutId = workoutResult.rows[0].id as number;
    isNewWorkout = workoutResult.rows[0].inserted === true;

    const [laps, streamsData] = await Promise.all([
      fetchActivityLaps(apiKey, activity.id),
      fetchActivityStreams(apiKey, activity.id)
    ]);

    await client.query(`delete from workout_laps where workout_id = $1`, [workoutId]);
    if (laps.length > 0) {
      await client.query(
        `
          insert into workout_laps (
            workout_id, strava_lap_id, name, distance_meters,
            elapsed_time_seconds, average_speed, average_heartrate,
            elevation_gain, start_index, end_index
          )
          select
            $1,
            unnest($2::bigint[]),
            unnest($3::text[]),
            unnest($4::float8[]),
            unnest($5::int[]),
            unnest($6::float8[]),
            unnest($7::float8[]),
            unnest($8::float8[]),
            unnest($9::int[]),
            unnest($10::int[])
        `,
        [
          workoutId,
          laps.map((lap, index) => lap.id ?? index + 1),
          laps.map((lap) => lap.label ?? null),
          laps.map((lap) => lap.distance ?? 0),
          laps.map((lap) => Math.round(lap.elapsed_time ?? 0)),
          laps.map((lap) => lap.average_speed ?? null),
          laps.map((lap) => lap.average_heartrate ?? null),
          laps.map((lap) => lap.total_elevation_gain ?? null),
          laps.map((lap) => lap.start_index ?? null),
          laps.map((lap) => lap.end_index ?? null)
        ]
      );
    }

    await client.query("COMMIT");

    if (streamsData) {
      await saveActivityStreams(workoutId, streamsData);
      await applyLapElevationChanges(workoutId, streamsData.altitude);
    }
    // Авто-фикс GPS при поступлении — только явно битые заезды, не блокируя импорт
    void maybeAutoFixWorkoutGps(userId, workoutId, activity.average_speed).catch((error) => {
      addStravaEvent({
        source: "system",
        level: "warn",
        message: "gps auto-fix failed",
        details: { workoutId, error: error instanceof Error ? error.message : "Unknown error" }
      });
    });
    void analyzeWorkout(workoutId).catch((error) => {
      addStravaEvent({
        source: "system",
        level: "warn",
        message: "workout analysis failed",
        details: {
          workoutId,
          error: error instanceof Error ? error.message : "Unknown error"
        }
      });
    });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  if (isNewWorkout) {
    await enqueueNewWorkoutTelegramNotification(workoutId);
  }

  return { workoutId, isNewWorkout, deduped: false };
}

// Авто-применение GPS-фикса при импорте. Консервативно:
// 1) дешёвый пред-фильтр по среднему темпу (нереально быстрый = сбой);
// 2) не трогаем, если уже есть коррекция (ручная или прежняя авто);
// 3) применяем ТОЛЬКО уверенную полную реконструкцию (full_rebuild + high) —
//    это катастрофический сбой; локальные всплески (segment_cleanup) оставляем
//    тренеру, чтобы не портить в основном нормальные заезды.
async function maybeAutoFixWorkoutGps(userId: number, workoutId: number, recordedSpeed: number | null) {
  if (!recordedSpeed || recordedSpeed <= AUTOFIX_SUSPECT_SPEED_MPS) {
    return;
  }
  if (await getActiveWorkoutCorrection(workoutId)) {
    return;
  }
  const workoutResult = await pool.query(`select * from workouts where id = $1`, [workoutId]);
  const workout = workoutResult.rows[0];
  if (!workout || !/run/i.test(String(workout.sport_type ?? ""))) {
    return;
  }
  const lapsResult = await pool.query(
    `select * from workout_laps where workout_id = $1 order by id asc`,
    [workoutId]
  );
  const streams = await getStoredActivityStreams(workoutId);
  const profile = await buildAthleteCadenceProfile(userId, workoutId);
  const preview = buildGpsFixPreview(workout, lapsResult.rows, streams, profile);
  if (!preview || preview.metadata.mode !== "full_rebuild" || preview.metadata.confidence !== "high") {
    return;
  }
  await upsertWorkoutCorrection(workoutId, userId, "gps_autofix", preview);
  await analyzeWorkout(workoutId);
  addStravaEvent({
    source: "system",
    level: "info",
    message: "gps auto-fix applied",
    details: {
      workoutId,
      from: Math.round(Number(workout.distance_meters) || 0),
      to: Math.round(preview.correctedWorkout.distance_meters)
    }
  });
}

async function tryAcquireSyncLock(userId: number) {
  const { rows } = await pool.query(`select pg_try_advisory_lock($1, $2) as locked`, [
    INTERVALS_SYNC_LOCK_NAMESPACE,
    userId
  ]);
  return rows[0]?.locked === true;
}

async function releaseSyncLock(userId: number) {
  await pool.query(`select pg_advisory_unlock($1, $2)`, [INTERVALS_SYNC_LOCK_NAMESPACE, userId]);
}

async function markSyncStarted(userId: number, startedAt: Date) {
  await pool.query(
    `update intervals_connections set sync_started_at = $2, last_sync_error = null where user_id = $1`,
    [userId, startedAt.toISOString()]
  );
}

async function markSyncCompleted(userId: number, finishedAt: Date, wasDeep: boolean) {
  await pool.query(
    `
      update intervals_connections
      set last_synced_at = $2,
          last_deep_synced_at = case when $3 then $2 else last_deep_synced_at end,
          sync_started_at = null
      where user_id = $1
    `,
    [userId, finishedAt.toISOString(), wasDeep]
  );
}

async function markSyncFailed(userId: number, error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error";
  await pool.query(
    `update intervals_connections set sync_started_at = null, last_sync_error = $2 where user_id = $1`,
    [userId, message.slice(0, 500)]
  );
}

function formatOldest(date: Date) {
  return date.toISOString().slice(0, 19);
}

export async function syncIntervalsLatestActivities(
  userId: number,
  options?: { forceDeep?: boolean }
): Promise<IntervalsSyncResult> {
  const lockAcquired = await tryAcquireSyncLock(userId);
  if (!lockAcquired) {
    return { synced: false, reason: "already_running" };
  }

  const startedAt = new Date();

  try {
    const connection = await getConnection(userId);
    if (!connection) {
      return { synced: false, reason: "not_connected" };
    }

    await markSyncStarted(userId, startedAt);

    const apiKey = decryptToken(connection.api_key);
    // Обычный тик смотрит на 36ч назад — дешево, но не видит тренировки,
    // загруженные в intervals.icu задним числом. Раз в сутки делаем
    // глубокий проход на DEEP_SYNC_DAYS, который их подбирает.
    // Ручная синхронизация из админки всегда глубокая: intervals.icu заносит
    // историю с часов (COROS backfill) с задержкой, обычный 36ч-тик её не видит
    const deepDue =
      Boolean(options?.forceDeep) ||
      !connection.last_deep_synced_at ||
      Date.now() - new Date(connection.last_deep_synced_at).getTime() > DEEP_SYNC_INTERVAL_MS;
    const oldestByMode = !connection.last_synced_at
      ? new Date(Date.now() - FIRST_SYNC_DAYS * 24 * 60 * 60 * 1000)
      : deepDue
        ? new Date(Date.now() - DEEP_SYNC_DAYS * 24 * 60 * 60 * 1000)
        : new Date(new Date(connection.last_synced_at).getTime() - SYNC_LOOKBACK_MS);
    const oldest = oldestByMode < SYNC_FLOOR ? SYNC_FLOOR : oldestByMode;

    const response = await intervalsFetch(
      apiKey,
      `/athlete/${encodeURIComponent(connection.icu_athlete_id)}/activities?oldest=${formatOldest(oldest)}`
    );

    if (!response.ok) {
      const errorBody = (await response.text()).slice(0, 500);
      throw new Error(
        `INTERVALS_ACTIVITIES_FAILED status=${response.status} ${response.statusText} body=${errorBody}`
      );
    }

    const activities = (await response.json()) as IntervalsActivity[];
    const runningActivities = activities.filter(isRunningActivity);
    let imported = 0;
    for (const activity of runningActivities) {
      const result = await syncSingleIntervalsActivity(userId, apiKey, activity);
      if (!result.deduped) {
        imported += 1;
      }
    }

    const finishedAt = new Date();
    await markSyncCompleted(userId, finishedAt, deepDue || !connection.last_synced_at);

    return {
      synced: true,
      imported,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString()
    };
  } catch (error) {
    await markSyncFailed(userId, error);
    throw error;
  } finally {
    await releaseSyncLock(userId);
  }
}

// Раз в час логинимся и дёргаем activities-sync за каждого атлета с сохранённым
// логином-паролем — воспроизводит заход на сайт, форсит подтяжку из COROS.
// Импорт к нам делает обычный 15-мин синк (свежая тренировка попадает в его окно).
export async function forceDueIntervalsAthletes(logger?: FastifyBaseLogger) {
  const { rows } = await pool.query(
    `select user_id from intervals_connections where icu_email is not null and icu_password is not null`
  );
  logger?.info({ athletes: rows.length }, "intervals force-refresh tick");
  let forced = 0;
  for (const row of rows) {
    const userId = row.user_id as number;
    try {
      const result = await forceIntervalsAccountRefresh(userId);
      if (result.forced) {
        forced += 1;
      } else {
        logger?.warn({ userId, reason: result.reason }, "intervals force-refresh skipped");
      }
    } catch (error) {
      logger?.error({ err: error, userId }, "intervals force-refresh failed");
      addStravaEvent({
        source: "cron",
        level: "error",
        message: "intervals force-refresh failed",
        details: { userId, error: error instanceof Error ? error.message : "Unknown error" }
      });
    }
  }
  addStravaEvent({
    source: "cron",
    level: "info",
    message: "intervals force-refresh tick",
    details: { athletes: rows.length, forced }
  });
  return forced;
}

export async function syncDueIntervalsAthletes(logger?: FastifyBaseLogger) {
  const intervalMinutes = config.STRAVA_SYNC_INTERVAL_MINUTES;
  const { rows } = await pool.query(
    `
      select user_id
      from intervals_connections
      where last_synced_at is null
         or last_synced_at < now() - make_interval(mins => $1::int)
      order by coalesce(last_synced_at, to_timestamp(0)) asc
    `,
    [intervalMinutes]
  );

  logger?.info({ dueAthletes: rows.length, intervalMinutes }, "intervals cron tick");
  addStravaEvent({
    source: "cron",
    level: "info",
    message: "intervals cron tick",
    details: { dueAthletes: rows.length, intervalMinutes }
  });

  for (const row of rows) {
    const userId = row.user_id as number;
    try {
      const result = await syncIntervalsLatestActivities(userId);
      logger?.info({ userId, result }, "intervals cron sync completed");
      addStravaEvent({
        source: "cron",
        level: "info",
        message: "intervals cron sync completed",
        details: { userId, result }
      });
    } catch (error) {
      logger?.error({ error, userId }, "intervals cron sync failed");
      addStravaEvent({
        source: "cron",
        level: "error",
        message: "intervals cron sync failed",
        details: {
          userId,
          error: error instanceof Error ? error.message : "Unknown error"
        }
      });
    }
  }

  return rows.length;
}
