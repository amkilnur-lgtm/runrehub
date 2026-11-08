// Результаты сезона: прошедшие старты с официальным временем и запланированные.
// Личные рекорды считаются по official_time_seconds, а не по GPS
export async function up(pgm) {
  pgm.sql(`
    create table if not exists race_results (
      id serial primary key,
      user_id integer not null references users(id) on delete cascade,
      status text not null check (status in ('planned', 'finished')),
      race_date date not null,
      name text not null,
      city text,
      distance_meters integer not null check (distance_meters > 0),
      official_time_seconds integer check (official_time_seconds > 0),
      goal_time_seconds integer check (goal_time_seconds > 0),
      place_overall integer check (place_overall > 0),
      participants integer check (participants > 0),
      place_category integer check (place_category > 0),
      protocol_url text,
      note text,
      workout_id integer references workouts(id) on delete set null,
      created_by_user_id integer references users(id) on delete set null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create index if not exists race_results_user_date_idx on race_results (user_id, race_date desc);
  `);
}

export async function down(pgm) {
  pgm.sql(`drop table if exists race_results;`);
}
