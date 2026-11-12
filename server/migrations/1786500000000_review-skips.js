// «Пропустить» в «Разборе»: тренер решил не комментировать пробежку — она уходит из очереди,
// счётчика и «Ждут комментария». Если спортсмен потом напишет — пробежка вернётся (ответ новее пропуска).
export async function up(pgm) {
  pgm.sql(`
    create table if not exists review_skips (
      workout_id integer not null references workouts(id) on delete cascade,
      coach_id integer not null references users(id) on delete cascade,
      skipped_at timestamptz not null default now(),
      primary key (workout_id, coach_id)
    );
  `);
}

export async function down(pgm) {
  pgm.sql(`drop table if exists review_skips;`);
}
