// Удалённые тренировки из intervals.icu: без этой отметки ежедневный глубокий
// синк (30 дней) импортировал их обратно. deleted_strava_activities знает только
// strava_activity_id, которого у тренировок intervals.icu нет.
export async function up(pgm) {
  pgm.sql(`
    create table if not exists deleted_source_activities (
      source text not null,
      source_activity_id text not null,
      user_id integer not null references users(id) on delete cascade,
      deleted_at timestamptz not null default now(),
      primary key (source, source_activity_id)
    );
  `);
}

export async function down(pgm) {
  pgm.sql(`drop table if exists deleted_source_activities;`);
}
