// Пороговый темп спортсмена (ставит тренер; иначе — оценка по лучшему старту) и
// время в зонах темпа по пробежкам. Зоны зависят от порога, поэтому храним, по какому считали
export async function up(pgm) {
  pgm.sql(`
    create table if not exists athlete_thresholds (
      athlete_id integer primary key references users(id) on delete cascade,
      pace_seconds_per_km integer not null check (pace_seconds_per_km between 150 and 600),
      updated_by integer references users(id) on delete set null,
      updated_at timestamptz not null default now()
    );
    create table if not exists workout_pace_zones (
      workout_id integer primary key references workouts(id) on delete cascade,
      threshold_seconds integer not null,
      z1_seconds integer not null default 0,
      z2_seconds integer not null default 0,
      z3_seconds integer not null default 0,
      z4_seconds integer not null default 0,
      z5_seconds integer not null default 0,
      computed_at timestamptz not null default now()
    );
  `);
}

export async function down(pgm) {
  pgm.sql(`drop table if exists workout_pace_zones; drop table if exists athlete_thresholds;`);
}
