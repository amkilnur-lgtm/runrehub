export async function up(pgm) {
  pgm.sql(`
    alter table users
    add column if not exists telegram_chat_id text,
    add column if not exists telegram_notifications_enabled boolean not null default false;
  `);

  pgm.sql(`
    create table if not exists telegram_notification_jobs (
      id serial primary key,
      workout_id integer not null references workouts(id) on delete cascade,
      coach_user_id integer not null references users(id) on delete cascade,
      kind text not null default 'new_workout',
      status text not null default 'pending',
      attempts integer not null default 0,
      last_error text,
      sent_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (workout_id, coach_user_id, kind)
    );
  `);

  pgm.sql(`
    create index if not exists telegram_notification_jobs_status_created_idx
      on telegram_notification_jobs(status, created_at asc);
  `);
}

export async function down(pgm) {
  pgm.sql(`
    drop table if exists telegram_notification_jobs;
  `);

  pgm.sql(`
    alter table users
    drop column if exists telegram_notifications_enabled,
    drop column if exists telegram_chat_id;
  `);
}
