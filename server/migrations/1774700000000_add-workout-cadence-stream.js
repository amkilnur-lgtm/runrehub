export async function up(pgm) {
  pgm.sql(`
    alter table workout_streams
    add column if not exists cadence_stream jsonb not null default '[]'::jsonb;
  `);
}

export async function down(pgm) {
  pgm.sql(`
    alter table workout_streams
    drop column if exists cadence_stream;
  `);
}
