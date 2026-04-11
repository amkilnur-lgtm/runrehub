export async function up(pgm) {
  pgm.sql(`
    alter table telegram_notification_jobs
      alter column workout_id drop not null,
      add column if not exists athlete_user_id integer references users(id) on delete cascade,
      add column if not exists report_week_start date;
  `);

  pgm.sql(`
    create unique index if not exists telegram_notification_jobs_weekly_unique_idx
      on telegram_notification_jobs(coach_user_id, athlete_user_id, report_week_start, kind)
      where kind = 'weekly_report';
  `);
}

export async function down(pgm) {
  pgm.sql(`
    drop index if exists telegram_notification_jobs_weekly_unique_idx;
  `);

  pgm.sql(`
    alter table telegram_notification_jobs
      drop column if exists report_week_start,
      drop column if exists athlete_user_id;
  `);
}
