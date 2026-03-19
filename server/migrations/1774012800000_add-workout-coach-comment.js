export async function up(pgm) {
  pgm.sql(`
    alter table workouts
    add column if not exists coach_comment text;
  `);
}

export async function down(pgm) {
  pgm.sql(`
    alter table workouts
    drop column if exists coach_comment;
  `);
}
