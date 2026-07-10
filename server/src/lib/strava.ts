// Strava-интеграция отключена (приложение деактивировано Strava 30.06.2026,
// источник тренировок теперь intervals.icu). Здесь остались общие утилиты:
// шифрование токенов, работа со стримами и кругами — ими пользуется intervals.ts.
import crypto from "node:crypto";

import { pool } from "./db.js";
import { config } from "../config.js";

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
  // беговая мощность: intervals.icu отдает, Strava для бега — нет
  watts?: number[];
};

const ENCRYPTED_TOKEN_PREFIX = "enc:v1:";

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

export function parseNumberStream(values: unknown[] | undefined) {
  if (!Array.isArray(values) || !isNumberArray(values)) {
    return [];
  }

  return values;
}

export function parseLatLngStream(values: unknown[] | undefined) {
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


export async function saveActivityStreams(workoutId: number, streams: ActivityStreams) {
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
        watts_stream,
        fetched_at
      )
      values ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, now())
      on conflict (workout_id) do update
      set distance_stream = excluded.distance_stream,
          time_stream = excluded.time_stream,
          heartrate_stream = excluded.heartrate_stream,
          cadence_stream = excluded.cadence_stream,
          altitude_stream = excluded.altitude_stream,
          velocity_stream = excluded.velocity_stream,
          latlng_stream = excluded.latlng_stream,
          watts_stream = excluded.watts_stream,
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
      JSON.stringify(streams.latlng),
      JSON.stringify(streams.watts ?? [])
    ]
  );
}

// Обновляем net elevation для всех лапов одним запросом вместо цикла UPDATE
export async function applyLapElevationChanges(workoutId: number, altitude: number[]) {
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
           , cadence_stream, watts_stream
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
    latlng: parseLatLngStream(Array.isArray(row.latlng_stream) ? row.latlng_stream : []),
    watts: Array.isArray(row.watts_stream) ? row.watts_stream : []
  } satisfies ActivityStreams;
}
