// Когда тренер последний раз писал свой комментарий к пробежке — чтобы понять,
// ответил ли он на сообщение спортсмена в обсуждении (очередь «Разбор»)
export async function up(pgm) {
  pgm.sql(`alter table workouts add column if not exists coach_comment_updated_at timestamptz;`);
}

export async function down(pgm) {
  pgm.sql(`alter table workouts drop column if exists coach_comment_updated_at;`);
}
