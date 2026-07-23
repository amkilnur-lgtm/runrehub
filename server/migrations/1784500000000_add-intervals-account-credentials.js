export async function up(pgm) {
  pgm.sql(`
    alter table intervals_connections
      add column if not exists icu_email text,
      add column if not exists icu_password text;
  `);
}

export async function down(pgm) {
  pgm.sql(`
    alter table intervals_connections
      drop column if exists icu_email,
      drop column if exists icu_password;
  `);
}
