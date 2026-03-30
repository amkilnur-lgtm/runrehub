export async function up(pgm) {
  pgm.sql(`
    create table if not exists workout_corrections (
      id serial primary key,
      workout_id integer not null unique references workouts(id) on delete cascade,
      kind text not null check (kind in ('gps_autofix')),
      corrected_distance_meters double precision not null default 0,
      corrected_moving_time_seconds integer not null default 0,
      corrected_elapsed_time_seconds integer not null default 0,
      corrected_elevation_gain double precision not null default 0,
      corrected_average_speed double precision,
      corrected_average_heartrate double precision,
      corrected_max_heartrate double precision,
      removed_segments jsonb not null default '[]'::jsonb,
      corrected_streams jsonb not null default '{}'::jsonb,
      corrected_laps jsonb not null default '[]'::jsonb,
      created_by_user_id integer not null references users(id) on delete restrict,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create index if not exists workout_corrections_created_by_user_id_idx
      on workout_corrections(created_by_user_id);
  `);
}

export async function down(pgm) {
  pgm.sql(`
    drop table if exists workout_corrections;
  `);
}
