import { pool } from "./db.js";
import { config } from "../config.js";

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete: {
    id: number;
  };
};

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

function assertStravaConfigured() {
  if (!config.STRAVA_CLIENT_ID || !config.STRAVA_CLIENT_SECRET) {
    throw new Error("STRAVA_NOT_CONFIGURED");
  }
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
      data.access_token,
      data.refresh_token,
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

  const expiresAt = new Date(connection.expires_at).getTime();
  if (expiresAt - Date.now() > 5 * 60 * 1000) {
    return connection.access_token as string;
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
      refresh_token: connection.refresh_token
    })
  });

  if (!response.ok) {
    throw new Error("STRAVA_REFRESH_FAILED");
  }

  const data = (await response.json()) as TokenResponse;
  await pool.query(
    `
      update strava_connections
      set access_token = $2,
          refresh_token = $3,
          expires_at = to_timestamp($4)
      where user_id = $1
    `,
    [userId, data.access_token, data.refresh_token, data.expires_at]
  );

  return data.access_token;
}

export async function syncLatestActivities(userId: number) {
  const token = await refreshAccessTokenIfNeeded(userId);
  if (!token) {
    return { synced: false, reason: "not_connected" };
  }

  const { rows } = await pool.query(
    `select connected_at, last_synced_at from strava_connections where user_id = $1`,
    [userId]
  );
  const connection = rows[0];
  const afterDate = connection.last_synced_at ?? connection.connected_at;
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

  for (const activity of activities) {
    const workoutResult = await pool.query(
      `
        insert into workouts (
          user_id,
          strava_activity_id,
          name,
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
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        on conflict (strava_activity_id) do update
        set name = excluded.name,
            sport_type = excluded.sport_type,
            start_date = excluded.start_date,
            distance_meters = excluded.distance_meters,
            moving_time_seconds = excluded.moving_time_seconds,
            elapsed_time_seconds = excluded.elapsed_time_seconds,
            elevation_gain = excluded.elevation_gain,
            average_speed = excluded.average_speed,
            average_heartrate = excluded.average_heartrate,
            max_heartrate = excluded.max_heartrate
        returning id
      `,
      [
        userId,
        activity.id,
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

    const workoutId = workoutResult.rows[0].id as number;
    const lapResponse = await fetch(
      `https://www.strava.com/api/v3/activities/${activity.id}/laps`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    if (lapResponse.ok) {
      const laps = (await lapResponse.json()) as StravaLap[];
      await pool.query(`delete from workout_laps where workout_id = $1`, [workoutId]);
      for (const lap of laps) {
        await pool.query(
          `
            insert into workout_laps (
              workout_id,
              strava_lap_id,
              name,
              distance_meters,
              elapsed_time_seconds,
              average_speed,
              average_heartrate,
              elevation_gain,
              start_index,
              end_index
            )
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          `,
          [
            workoutId,
            lap.id,
            lap.name,
            lap.distance,
            lap.elapsed_time,
            lap.average_speed ?? null,
            lap.average_heartrate ?? null,
            lap.total_elevation_gain ?? null,
            lap.start_index ?? null,
            lap.end_index ?? null
          ]
        );
      }
    }
  }

  await pool.query(
    `update strava_connections set last_synced_at = now() where user_id = $1`,
    [userId]
  );

  return { synced: true, imported: activities.length };
}
