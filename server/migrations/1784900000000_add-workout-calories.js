// Калории из intervals.icu (activity.calories) — для плитки «ккал» на карточках в Telegram
export async function up(pgm) {
  pgm.sql(`alter table workouts add column if not exists calories integer;`);
}

export async function down(pgm) {
  pgm.sql(`alter table workouts drop column if exists calories;`);
}
