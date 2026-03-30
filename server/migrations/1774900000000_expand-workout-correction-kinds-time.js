export async function up(pgm) {
  pgm.sql(`
    alter table workout_corrections
      drop constraint if exists workout_corrections_kind_check;

    alter table workout_corrections
      add constraint workout_corrections_kind_check
      check (kind in ('gps_autofix', 'manual_distance', 'manual_time'));
  `);
}

export async function down(pgm) {
  pgm.sql(`
    alter table workout_corrections
      drop constraint if exists workout_corrections_kind_check;

    alter table workout_corrections
      add constraint workout_corrections_kind_check
      check (kind in ('gps_autofix', 'manual_distance'));
  `);
}
