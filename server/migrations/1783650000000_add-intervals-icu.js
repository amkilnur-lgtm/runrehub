export async function up(pgm) {
  pgm.sql(`
    create table if not exists intervals_connections (
      user_id integer primary key references users(id) on delete cascade,
      icu_athlete_id text not null,
      api_key text not null,
      connected_at timestamptz not null default now(),
      last_synced_at timestamptz,
      sync_started_at timestamptz,
      last_sync_error text
    );
  `);

  pgm.sql(`alter table workouts add column if not exists source text not null default 'strava';`);
  pgm.sql(`alter table workouts add column if not exists source_activity_id text;`);
  pgm.sql(`update workouts set source_activity_id = strava_activity_id::text where source_activity_id is null;`);
  pgm.sql(`alter table workouts alter column source_activity_id set not null;`);
  pgm.sql(`alter table workouts alter column strava_activity_id drop not null;`);
  pgm.sql(`
    create unique index if not exists workouts_source_activity_idx
      on workouts(source, source_activity_id);
  `);
}

export async function down(pgm) {
  pgm.sql(`drop index if exists workouts_source_activity_idx;`);
  pgm.sql(`delete from workouts where strava_activity_id is null;`);
  pgm.sql(`alter table workouts alter column strava_activity_id set not null;`);
  pgm.sql(`alter table workouts drop column if exists source_activity_id;`);
  pgm.sql(`alter table workouts drop column if exists source;`);
  pgm.sql(`drop table if exists intervals_connections;`);
}
