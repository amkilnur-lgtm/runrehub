export async function up(pgm) {
  pgm.sql(`alter table workouts add column if not exists grade_adjusted_speed double precision;`);
  pgm.sql(`alter table workouts add column if not exists average_cadence double precision;`);
  pgm.sql(`alter table workouts add column if not exists average_stride double precision;`);
  pgm.sql(`alter table workouts add column if not exists training_load double precision;`);
  pgm.sql(`alter table workouts add column if not exists device_name text;`);
  pgm.sql(`alter table workout_streams add column if not exists watts_stream jsonb not null default '[]'::jsonb;`);
}

export async function down(pgm) {
  pgm.sql(`alter table workout_streams drop column if exists watts_stream;`);
  pgm.sql(`alter table workouts drop column if exists device_name;`);
  pgm.sql(`alter table workouts drop column if exists training_load;`);
  pgm.sql(`alter table workouts drop column if exists average_stride;`);
  pgm.sql(`alter table workouts drop column if exists average_cadence;`);
  pgm.sql(`alter table workouts drop column if exists grade_adjusted_speed;`);
}
