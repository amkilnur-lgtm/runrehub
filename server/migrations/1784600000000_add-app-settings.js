export async function up(pgm) {
  pgm.sql(`
    create table if not exists app_settings (
      key text primary key,
      value text not null,
      updated_at timestamptz not null default now()
    );
  `);
}

export async function down(pgm) {
  pgm.sql(`drop table if exists app_settings;`);
}
