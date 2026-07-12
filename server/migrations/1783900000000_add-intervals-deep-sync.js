export async function up(pgm) {
  pgm.sql(`alter table intervals_connections add column if not exists last_deep_synced_at timestamptz;`);
}

export async function down(pgm) {
  pgm.sql(`alter table intervals_connections drop column if exists last_deep_synced_at;`);
}
