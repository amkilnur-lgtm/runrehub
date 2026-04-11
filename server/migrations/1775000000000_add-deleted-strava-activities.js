export async function up(pgm) {
  pgm.sql(`
    create table if not exists deleted_strava_activities (
      user_id integer not null references users(id) on delete cascade,
      strava_activity_id bigint not null,
      deleted_at timestamptz not null default now(),
      primary key (user_id, strava_activity_id)
    );

    create index if not exists deleted_strava_activities_deleted_at_idx
      on deleted_strava_activities(deleted_at desc);
  `);
}

export async function down(pgm) {
  pgm.sql(`
    drop table if exists deleted_strava_activities;
  `);
}
