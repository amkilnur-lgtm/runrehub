import crypto from "node:crypto";

import { FastifyBaseLogger } from "fastify";

import { pool } from "./db.js";
import { addStravaEvent } from "./strava-events.js";
import { enqueueNewWorkoutTelegramNotification } from "./telegram-notifications.js";
import { config } from "../config.js";

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete: {
    id: number;
  };
};

type StravaWebhookPayload = {
  owner_id?: number;
  object_id?: number;
  aspect_type?: string;
  object_type?: string;
  event_time?: number;
  subscription_id?: number;
  updates?: Record<string, unknown>;
};

export type SyncLatestActivitiesResult =
  | { synced: true; imported: number; startedAt: string; finishedAt: string }
  | { synced: false; reason: "not_connected" | "already_running"; startedAt?: string; finishedAt?: string };

type StravaActivity = {
  id: number;
  name: string;
  sport_type: string;
  start_date: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  total_elevation_gain: number;
  average_speed: number | null;
  average_heartrate?: number | null;
  max_heartrate?: number | null;
};

type StravaLap = {
  id: number;
  name: string | null;
  distance: number;
  elapsed_time: number;
  average_speed: number | null;
  average_heartrate?: number | null;
  total_elevation_gain?: number | null;
  start_index?: number | null;
  end_index?: number | null;
};

type StreamPayload = Record<string, { type: string; data: unknown[] } | undefined>;

type LapRow = {
  id: number;
  strava_lap_id: number;
  name: string | null;
  distance_meters: number;
  elapsed_time_seconds: number;
  average_speed: number | null;
  average_heartrate: number | null;
  elevation_gain: number | null;
  start_index: number | null;
  end_index: number | null;
};

export type ActivityStreams = {
  distance: number[];
  time: number[];
  heartrate: number[];
  cadence: number[];
  altitude: number[];
  velocity_smooth: number[];
  latlng: [number, number][];
};

const SYNC_LOOKBACK_MS = 36 * 60 * 60 * 1000;
const STRAVA_SYNC_LOCK_NAMESPACE = 4271;
const ENCRYPTED_TOKEN_PREFIX = "enc:v1:";
const RUN_SPORT_TYPES = new Set(["run", "trailrun", "virtualrun"]);

function assertStravaConfigured() {
  if (!config.STRAVA_CLIENT_ID || !config.STRAVA_CLIENT_SECRET) {
    throw new Error("STRAVA_NOT_CONFIGURED");
  }
}

function isRunningActivity(activity: Pick<StravaActivity, "sport_type">) {
  const normalizedSportType = activity.sport_type.trim().toLowerCase();
  return RUN_SPORT_TYPES.has(normalizedSportType);
}

export async function markStravaActivityDeleted(userId: number, stravaActivityId: number) {
  await pool.query(
    `
      insert into deleted_strava_activities (user_id, strava_activity_id)
      values ($1, $2)
      on conflict (user_id, strava_activity_id) do update
      set deleted_at = now()
    `,
    [userId, stravaActivityId]
  );
}

async function filterOutDeletedActivities(userId: number, activities: StravaActivity[]) {
  if (!activities.length) {
    return activities;
  }

  const { rows } = await pool.query<{ strava_activity_id: string | number }>(
    `
      select strava_activity_id
      from deleted_strava_activities
      where user_id = $1
        and strava_activity_id = any($2::bigint[])
    `,
    [userId, activities.map((activity) => activity.id)]
  );

  if (!rows.length) {
    return activities;
  }

  const deletedIds = new Set(rows.map((row) => Number(row.strava_activity_id)));
  return activities.filter((activity) => !deletedIds.has(activity.id));
}

export function getTokenEncryptionKey() {
  if (!config.STRAVA_TOKEN_ENCRYPTION_KEY) {
    return null;
  }

  return crypto.createHash("sha256").update(config.STRAVA_TOKEN_ENCRYPTION_KEY).digest();
}

export function encryptToken(token: string) {
  const key = getTokenEncryptionKey();
  if (!key) {
    return token;
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${ENCRYPTED_TOKEN_PREFIX}${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptToken(token: string) {
  if (!token.startsWith(ENCRYPTED_TOKEN_PREFIX)) {
    return token;
  }

  const key = getTokenEncryptionKey();
  if (!key) {
    throw new Error("STRAVA_TOKEN_ENCRYPTION_KEY_MISSING");
  }

  const parts = token.slice(ENCRYPTED_TOKEN_PREFIX.length).split(":");
  if (parts.length !== 3) {
    throw new Error("STRAVA_TOKEN_DECRYPT_FAILED");
  }

  const [ivBase64, authTagBase64, encryptedBase64] = parts;
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivBase64, "base64")
  );
  decipher.setAuthTag(Buffer.from(authTagBase64, "base64"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedBase64, "base64")),
    decipher.final()
  ]);

  return decrypted.toString("utf8");
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });

  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );

  return asUtc - date.getTime();
}

function getStartOfTodayInTimeZone(timeZone: string) {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const [year, month, day] = formatter.format(now).split("-").map(Number);
  const utcGuess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const offsetMs = getTimeZoneOffsetMs(utcGuess, timeZone);
  return new Date(utcGuess.getTime() - offsetMs);
}

function computeLapNetElevation(
  altitude: number[],
  startIndex: number | null,
  endIndex: number | null
) {
  if (
    !altitude.length ||
    startIndex === null ||
    endIndex === null ||
    !Number.isInteger(startIndex) ||
    !Number.isInteger(endIndex)
  ) {
    return null;
  }

  const start = Math.max(0, Math.min(startIndex, altitude.length - 1));
  const end = Math.max(start, Math.min(endIndex, altitude.length - 1));
  const startAltitude = altitude[start];
  const endAltitude = altitude[end];

  if (!Number.isFinite(startAltitude) || !Number.isFinite(endAltitude)) {
    return null;
  }

  return endAltitude - startAltitude;
}

function isNumberArray(values: unknown[]): values is number[] {
  return values.every((value) => typeof value === "number" && Number.isFinite(value));
}

function parseNumberStream(values: unknown[] | undefined) {
  if (!Array.isArray(values) || !isNumberArray(values)) {
    return [];
  }

  return values;
}

function parseLatLngStream(values: unknown[] | undefined) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values.filter((value): value is [number, number] => (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1])
  ));
}

async function fetchActivityStreamsFromStrava(userId: number, activityId: number) {
  const token = await refreshAccessTokenIfNeeded(userId);
  if (!token) {
    return null;
  }

  const response = await fetch(
    `https://www.strava.com/api/v3/activities/${activityId}/streams?keys=distance,time,heartrate,cadence,altitude,velocity_smooth,latlng&key_by_type=true`,
    {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as StreamPayload;
  return {
    distance: parseNumberStream(payload.distance?.data),
    time: parseNumberStream(payload.time?.data),
    heartrate: parseNumberStream(payload.heartrate?.data),
    cadence: parseNumberStream(payload.cadence?.data),
    altitude: parseNumberStream(payload.altitude?.data),
    velocity_smooth: parseNumberStream(payload.velocity_smooth?.data),
    latlng: parseLatLngStream(payload.latlng?.data)
  } satisfies ActivityStreams;
}

async function saveActivityStreams(workoutId: number, streams: ActivityStreams) {
  await pool.query(
    `
      insert into workout_streams (
        workout_id,
        distance_stream,
        time_stream,
        heartrate_stream,
        cadence_stream,
        altitude_stream,
        velocity_stream,
        latlng_stream,
        fetched_at
      )
      values ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, now())
      on conflict (workout_id) do update
      set distance_stream = excluded.distance_stream,
          time_stream = excluded.time_stream,
          heartrate_stream = excluded.heartrate_stream,
          cadence_stream = excluded.cadence_stream,
          altitude_stream = excluded.altitude_stream,
          velocity_stream = excluded.velocity_stream,
          latlng_stream = excluded.latlng_stream,
          fetched_at = now()
    `,
    [
      workoutId,
      JSON.stringify(streams.distance),
      JSON.stringify(streams.time),
      JSON.stringify(streams.heartrate),
      JSON.stringify(streams.cadence),
      JSON.stringify(streams.altitude),
      JSON.stringify(streams.velocity_smooth),
      JSON.stringify(streams.latlng)
    ]
  );
}

async function tryAcquireSyncLock(userId: number) {
  const { rows } = await pool.query(
    `select pg_try_advisory_lock($1, $2) as locked`,
    [STRAVA_SYNC_LOCK_NAMESPACE, userId]
  );
  return rows[0]?.locked === true;
}

async function releaseSyncLock(userId: number) {
  await pool.query(`select pg_advisory_unlock($1, $2)`, [STRAVA_SYNC_LOCK_NAMESPACE, userId]);
}

async function markSyncStarted(userId: number, startedAt: Date) {
  await pool.query(
    `
      update strava_connections
      set sync_started_at = $2,
          last_sync_error = null
      where user_id = $1
    `,
    [userId, startedAt]
  );
}

async function markSyncCompleted(userId: number, startedAt: Date, finishedAt: Date) {
  await pool.query(
    `
      update strava_connections
      set sync_started_at = null,
          last_synced_at = $2,
          last_sync_error = null
      where user_id = $1
        and (sync_started_at is null or sync_started_at = $3)
    `,
    [userId, finishedAt, startedAt]
  );
}

async function markSyncFailed(userId: number, startedAt: Date, error: unknown) {
  const errorMessage = error instanceof Error ? error.message : "Unknown error";
  await pool.query(
    `
      update strava_connections
      set sync_started_at = null,
          last_sync_error = $2
      where user_id = $1
        and (sync_started_at is null or sync_started_at = $3)
    `,
    [userId, errorMessage.slice(0, 1000), startedAt]
  );
}

export function createWebhookFingerprint(payload: StravaWebhookPayload) {
  const fingerprintSource = JSON.stringify({
    ownerId: payload.owner_id ?? null,
    objectId: payload.object_id ?? null,
    aspectType: payload.aspect_type ?? null,
    objectType: payload.object_type ?? null,
    eventTime: payload.event_time ?? null,
    subscriptionId: payload.subscription_id ?? null,
    updates: payload.updates ?? null
  });

  return crypto.createHash("sha256").update(fingerprintSource).digest("hex");
}

export async function registerStravaWebhookEvent(payload: StravaWebhookPayload) {
  const fingerprint = createWebhookFingerprint(payload);
  const result = await pool.query(
    `
      insert into strava_webhook_events (fingerprint, payload)
      values ($1, $2::jsonb)
      on conflict (fingerprint) do nothing
      returning id
    `,
    [fingerprint, JSON.stringify(payload)]
  );

  return {
    fingerprint,
    isDuplicate: !result.rows[0]
  };
}

// Обновляем net elevation для всех лапов одним запросом вместо цикла UPDATE
async function applyLapElevationChanges(workoutId: number, altitude: number[]) {
  const lapsResult = await pool.query(
    `
      select id, start_index, end_index
      from workout_laps
      where workout_id = $1
      order by id asc
    `,
    [workoutId]
  );

  const ids: number[] = [];
  const elevations: number[] = [];

  for (const lap of lapsResult.rows as Pick<LapRow, "id" | "start_index" | "end_index">[]) {
    const netElevation = computeLapNetElevation(altitude, lap.start_index, lap.end_index);
    if (netElevation === null) continue;
    ids.push(lap.id);
    elevations.push(netElevation);
  }

  if (ids.length === 0) return;

  // Один UPDATE для всех лапов через unnest
  await pool.query(
    `
      update workout_laps as wl
      set elevation_gain = updates.elevation
      from (
        select unnest($1::int[]) as id, unnest($2::float8[]) as elevation
      ) as updates
      where wl.id = updates.id
    `,
    [ids, elevations]
  );
}

export async function getStoredActivityStreams(workoutId: number) {
  const { rows } = await pool.query(
    `
      select distance_stream, time_stream, heartrate_stream, altitude_stream, velocity_stream, latlng_stream
           , cadence_stream
      from workout_streams
      where workout_id = $1
    `,
    [workoutId]
  );

  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    distance: Array.isArray(row.distance_stream) ? row.distance_stream : [],
    time: Array.isArray(row.time_stream) ? row.time_stream : [],
    heartrate: Array.isArray(row.heartrate_stream) ? row.heartrate_stream : [],
    cadence: Array.isArray(row.cadence_stream) ? row.cadence_stream : [],
    altitude: Array.isArray(row.altitude_stream) ? row.altitude_stream : [],
    velocity_smooth: Array.isArray(row.velocity_stream) ? row.velocity_stream : [],
    latlng: parseLatLngStream(Array.isArray(row.latlng_stream) ? row.latlng_stream : [])
  } satisfies ActivityStreams;
}

// Вся синхронизация одной активности выполняется в транзакции.
// При ошибке на любом шаге данные откатываются — нет частичных записей.
async function syncSingleActivity(userId: number, token: string, activity: StravaActivity) {
  const client = await pool.connect();
  let workoutId: number;
  let isNewWorkout = false;

  try {
    await client.query("BEGIN");

    const workoutResult = await client.query(
      `
        insert into workouts (
          user_id,
          strava_activity_id,
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
          max_heartrate
        )
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        on conflict (strava_activity_id) do update
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
            max_heartrate = excluded.max_heartrate
        returning id, (xmax = 0) as inserted
      `,
      [
        userId,
        activity.id,
        activity.name,
        activity.name,
        activity.sport_type,
        activity.start_date,
        activity.distance,
        activity.moving_time,
        activity.elapsed_time,
        activity.total_elevation_gain,
        activity.average_speed,
        activity.average_heartrate ?? null,
        activity.max_heartrate ?? null
      ]
    );

    workoutId = workoutResult.rows[0].id as number;
    isNewWorkout = workoutResult.rows[0].inserted === true;

    // Загружаем laps параллельно со streams
    const [lapResponse, streamsData] = await Promise.all([
      fetch(`https://www.strava.com/api/v3/activities/${activity.id}/laps`, {
        headers: { Authorization: `Bearer ${token}` }
      }),
      fetchActivityStreamsFromStrava(userId, activity.id)
    ]);

    // Batch-вставка лапов: один DELETE + один INSERT вместо N INSERT
    if (lapResponse.ok) {
      const laps = (await lapResponse.json()) as StravaLap[];
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
            laps.map((l) => l.id),
            laps.map((l) => l.name ?? null),
            laps.map((l) => l.distance),
            laps.map((l) => l.elapsed_time),
            laps.map((l) => l.average_speed ?? null),
            laps.map((l) => l.average_heartrate ?? null),
            laps.map((l) => l.total_elevation_gain ?? null),
            laps.map((l) => l.start_index ?? null),
            laps.map((l) => l.end_index ?? null)
          ]
        );
      }
    }

    await client.query("COMMIT");

    // Streams и elevation update — после коммита (не критично для консистентности workout)
    if (streamsData) {
      await saveActivityStreams(workoutId, streamsData);
      await applyLapElevationChanges(workoutId, streamsData.altitude);
    }
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  if (isNewWorkout) {
    await enqueueNewWorkoutTelegramNotification(workoutId);
  }

  return { workoutId, isNewWorkout };
}

export function getStravaAuthUrl() {
  assertStravaConfigured();
  const url = new URL("https://www.strava.com/oauth/authorize");
  url.searchParams.set("client_id", config.STRAVA_CLIENT_ID!);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", `${config.APP_URL}/api/strava/callback`);
  url.searchParams.set("approval_prompt", "auto");
  url.searchParams.set("scope", "activity:read_all,profile:read_all");
  return url.toString();
}

export async function exchangeCodeForToken(code: string, userId: number) {
  assertStravaConfigured();
  const response = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      client_id: config.STRAVA_CLIENT_ID,
      client_secret: config.STRAVA_CLIENT_SECRET,
      code,
      grant_type: "authorization_code"
    })
  });

  if (!response.ok) {
    throw new Error("STRAVA_TOKEN_EXCHANGE_FAILED");
  }

  const data = (await response.json()) as TokenResponse;
  const encryptedAccessToken = encryptToken(data.access_token);
  const encryptedRefreshToken = encryptToken(data.refresh_token);
  await pool.query(
    `
      insert into strava_connections (
        user_id,
        strava_athlete_id,
        access_token,
        refresh_token,
        expires_at,
        connected_at,
        last_synced_at
      )
      values ($1, $2, $3, $4, to_timestamp($5), now(), null)
      on conflict (user_id) do update
      set strava_athlete_id = excluded.strava_athlete_id,
          access_token = excluded.access_token,
          refresh_token = excluded.refresh_token,
          expires_at = excluded.expires_at,
          connected_at = now()
    `,
    [
      userId,
      data.athlete.id,
      encryptedAccessToken,
      encryptedRefreshToken,
      data.expires_at
    ]
  );
}

async function refreshAccessTokenIfNeeded(userId: number) {
  assertStravaConfigured();
  const { rows } = await pool.query(
    `select * from strava_connections where user_id = $1`,
    [userId]
  );
  const connection = rows[0];
  if (!connection) {
    return null;
  }

  const accessToken = decryptToken(connection.access_token as string);
  const refreshToken = decryptToken(connection.refresh_token as string);

  const expiresAt = new Date(connection.expires_at).getTime();
  if (expiresAt - Date.now() > 5 * 60 * 1000) {
    return accessToken;
  }

  const response = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      client_id: config.STRAVA_CLIENT_ID,
      client_secret: config.STRAVA_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken
    })
  });

  if (!response.ok) {
    throw new Error("STRAVA_REFRESH_FAILED");
  }

  const data = (await response.json()) as TokenResponse;
  const encryptedAccessToken = encryptToken(data.access_token);
  const encryptedRefreshToken = encryptToken(data.refresh_token);
  await pool.query(
    `
      update strava_connections
      set access_token = $2,
          refresh_token = $3,
          expires_at = to_timestamp($4)
      where user_id = $1
    `,
    [userId, encryptedAccessToken, encryptedRefreshToken, data.expires_at]
  );

  return data.access_token;
}

export async function ensureActivityStreams(userId: number, workoutId: number, activityId: number) {
  const stored = await getStoredActivityStreams(workoutId);
  if (stored && stored.time.length && stored.distance.length) {
    return stored;
  }

  const fetched = await fetchActivityStreamsFromStrava(userId, activityId);
  if (!fetched) {
    return null;
  }

  await saveActivityStreams(workoutId, fetched);
  await applyLapElevationChanges(workoutId, fetched.altitude);
  return fetched;
}

export async function syncLatestActivities(userId: number): Promise<SyncLatestActivitiesResult> {
  const lockAcquired = await tryAcquireSyncLock(userId);
  if (!lockAcquired) {
    return { synced: false, reason: "already_running" };
  }

  const startedAt = new Date();

  try {
    const token = await refreshAccessTokenIfNeeded(userId);
    if (!token) {
      return { synced: false, reason: "not_connected" };
    }

    await markSyncStarted(userId, startedAt);

    const { rows } = await pool.query(
      `select connected_at, last_synced_at from strava_connections where user_id = $1`,
      [userId]
    );
    const connection = rows[0];
    const afterDate = connection.last_synced_at
      ? new Date(new Date(connection.last_synced_at).getTime() - SYNC_LOOKBACK_MS)
      : getStartOfTodayInTimeZone(config.APP_TIMEZONE);
    const after = Math.floor(new Date(afterDate).getTime() / 1000);

    const activityResponse = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=20`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    if (!activityResponse.ok) {
      throw new Error("STRAVA_ACTIVITIES_FAILED");
    }

    const activities = (await activityResponse.json()) as StravaActivity[];
    const runningActivities = activities.filter(isRunningActivity);
    const importableActivities = await filterOutDeletedActivities(userId, runningActivities);
    for (const activity of importableActivities) {
      await syncSingleActivity(userId, token, activity);
    }

    const finishedAt = new Date();
    await markSyncCompleted(userId, startedAt, finishedAt);

    return {
      synced: true,
      imported: importableActivities.length,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString()
    };
  } catch (error) {
    await markSyncFailed(userId, startedAt, error);
    throw error;
  } finally {
    await releaseSyncLock(userId);
  }
}

export async function syncDueAthletes(logger?: FastifyBaseLogger) {
  const intervalMinutes = config.STRAVA_SYNC_INTERVAL_MINUTES;
  const { rows } = await pool.query(
    `
      select user_id
      from strava_connections
      where last_synced_at is null
         or last_synced_at < now() - make_interval(mins => $1::int)
      order by coalesce(last_synced_at, to_timestamp(0)) asc
    `,
    [intervalMinutes]
  );

  logger?.info({ dueAthletes: rows.length, intervalMinutes }, "strava cron tick");
  addStravaEvent({
    source: "cron",
    level: "info",
    message: "strava cron tick",
    details: { dueAthletes: rows.length, intervalMinutes }
  });

  for (const row of rows) {
    const userId = row.user_id as number;
    try {
      const result = await syncLatestActivities(userId);
      logger?.info({ userId, result }, "strava cron sync completed");
      addStravaEvent({
        source: "cron",
        level: "info",
        message: "strava cron sync completed",
        details: { userId, result }
      });
    } catch (error) {
      logger?.error({ error, userId }, "strava cron sync failed");
      addStravaEvent({
        source: "cron",
        level: "error",
        message: "strava cron sync failed",
        details: {
          userId,
          error: error instanceof Error ? error.message : "Unknown error"
        }
      });
    }
  }

  return rows.length;
}
