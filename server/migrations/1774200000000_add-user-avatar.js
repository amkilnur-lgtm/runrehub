export async function up(pgm) {
  pgm.sql(`
    alter table users
      add column if not exists avatar_url text;
  `);
}

export async function down() {}
