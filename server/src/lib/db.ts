import pg from "pg";

import { config } from "../config.js";
import { hashPassword } from "./auth.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.DATABASE_URL
});

export async function ensureSchema() {
  await pool.query(`
    create table if not exists users (
      id serial primary key,
      username text not null unique,
      password_hash text not null,
      full_name text not null,
      role text not null check (role in ('admin', 'trainer', 'athlete')),
      coach_id integer references users(id) on delete set null,
      created_at timestamptz not null default now()
    );

    create table if not exists strava_connections (
      user_id integer primary key references users(id) on delete cascade,
      strava_athlete_id bigint not null unique,
      access_token text not null,
      refresh_token text not null,
      expires_at timestamptz not null,
      connected_at timestamptz not null default now(),
      last_synced_at timestamptz
    );

    create table if not exists workouts (
      id serial primary key,
      user_id integer not null references users(id) on delete cascade,
      strava_activity_id bigint not null unique,
      name text not null,
      sport_type text not null,
      start_date timestamptz not null,
      distance_meters double precision not null default 0,
      moving_time_seconds integer not null default 0,
      elapsed_time_seconds integer not null default 0,
      elevation_gain double precision not null default 0,
      average_speed double precision,
      average_heartrate double precision,
      max_heartrate double precision,
      created_at timestamptz not null default now()
    );

    create table if not exists workout_laps (
      id serial primary key,
      workout_id integer not null references workouts(id) on delete cascade,
      strava_lap_id bigint not null,
      name text,
      distance_meters double precision not null default 0,
      elapsed_time_seconds integer not null default 0,
      average_speed double precision,
      average_heartrate double precision,
      elevation_gain double precision,
      start_index integer,
      end_index integer,
      unique (workout_id, strava_lap_id)
    );

    create table if not exists workout_streams (
      workout_id integer primary key references workouts(id) on delete cascade,
      distance_stream jsonb not null default '[]'::jsonb,
      heartrate_stream jsonb not null default '[]'::jsonb,
      altitude_stream jsonb not null default '[]'::jsonb,
      velocity_stream jsonb not null default '[]'::jsonb,
      fetched_at timestamptz not null default now()
    );

    create index if not exists workouts_user_id_start_date_idx on workouts(user_id, start_date desc);
  `);

  const adminCount = await pool.query(
    `select count(*)::int as count from users where role = 'admin'`
  );

  if (adminCount.rows[0].count === 0) {
    const passwordHash = await hashPassword(config.ADMIN_PASSWORD);
    await pool.query(
      `
        insert into users (username, password_hash, full_name, role)
        values ($1, $2, $3, 'admin')
      `,
      [config.ADMIN_USERNAME, passwordHash, config.ADMIN_FULL_NAME]
    );
  }
}
