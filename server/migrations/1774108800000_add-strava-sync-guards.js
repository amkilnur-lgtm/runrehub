export async function up(pgm) {
  pgm.sql(`
    alter table strava_connections
    add column if not exists sync_started_at timestamptz,
    add column if not exists last_sync_error text;

    create table if not exists strava_webhook_events (
      id serial primary key,
      fingerprint text not null unique,
      payload jsonb not null,
      received_at timestamptz not null default now()
    );

    create index if not exists strava_webhook_events_received_at_idx
      on strava_webhook_events(received_at desc);
  `);
}

export async function down(pgm) {
  pgm.sql(`
    drop table if exists strava_webhook_events;

    alter table strava_connections
    drop column if exists sync_started_at,
    drop column if exists last_sync_error;
  `);
}
