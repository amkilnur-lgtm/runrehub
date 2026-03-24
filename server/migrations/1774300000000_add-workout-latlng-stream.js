export async function up(pgm) {
  pgm.sql(`
    alter table workout_streams
    add column if not exists latlng_stream jsonb not null default '[]'::jsonb;
  `);
}

export async function down(pgm) {
  pgm.sql(`
    alter table workout_streams
    drop column if exists latlng_stream;
  `);
}
