export async function up(pgm) {
  pgm.sql(`
    alter table telegram_notification_jobs
      add column if not exists report_month_start date;
  `);

  pgm.sql(`
    create unique index if not exists telegram_notification_jobs_monthly_unique_idx
      on telegram_notification_jobs(coach_user_id, athlete_user_id, report_month_start, kind)
      where kind = 'monthly_report';
  `);
}

export async function down(pgm) {
  pgm.sql(`
    drop index if exists telegram_notification_jobs_monthly_unique_idx;
  `);

  pgm.sql(`
    alter table telegram_notification_jobs
      drop column if exists report_month_start;
  `);
}
