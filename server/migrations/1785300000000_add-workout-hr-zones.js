// Время в зонах пульса по каждой пробежке (общие зоны клуба: до 130 · 130–150 · 150–162 · 162+).
// Считается один раз по потоку пульса и хранится — тепловой карте группы не нужно
// перечитывать потоки сотен пробежек на каждый запрос
export async function up(pgm) {
  pgm.sql(`
    create table if not exists workout_hr_zones (
      workout_id integer primary key references workouts(id) on delete cascade,
      z1_seconds integer not null default 0,
      z2_seconds integer not null default 0,
      z3_seconds integer not null default 0,
      z4_seconds integer not null default 0,
      computed_at timestamptz not null default now()
    );
  `);
}

export async function down(pgm) {
  pgm.sql(`drop table if exists workout_hr_zones;`);
}
