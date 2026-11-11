// Личные пульсовые зоны: 5 зон Фрила от порогового пульса из intervals.icu (если нет — оценка от макс. пульса).
// workout_hr_zones хранит время в 5 зонах и границы, по которым посчитано, — при смене порога пересчитываем.
export async function up(pgm) {
  pgm.sql(`
    alter table users add column if not exists hr_lthr smallint,
      add column if not exists hr_max smallint,
      add column if not exists hr_zone_bounds jsonb,
      add column if not exists hr_zones_updated_at timestamptz;
    alter table workout_hr_zones add column if not exists z5_seconds integer not null default 0,
      add column if not exists zone_key text;
  `);
}

export async function down(pgm) {
  pgm.sql(`
    alter table users drop column if exists hr_lthr, drop column if exists hr_max,
      drop column if exists hr_zone_bounds, drop column if exists hr_zones_updated_at;
    alter table workout_hr_zones drop column if exists z5_seconds, drop column if exists zone_key;
  `);
}
