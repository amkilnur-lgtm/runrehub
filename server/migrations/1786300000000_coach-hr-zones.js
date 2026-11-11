// Макс. пульс / пороговый пульс, указанные тренером (по тесту) — главнее intervals.icu и оценки по истории
export async function up(pgm) {
  pgm.sql(`alter table users add column if not exists hr_max_coach smallint, add column if not exists hr_lthr_coach smallint;`);
}

export async function down(pgm) {
  pgm.sql(`alter table users drop column if exists hr_max_coach, drop column if exists hr_lthr_coach;`);
}
