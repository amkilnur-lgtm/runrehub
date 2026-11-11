// Анализы — файлами (фото или PDF бланка лаборатории) вместо ручного ввода чисел.
// Файлы лежат вне публичной папки uploads/avatars и отдаются только по короткой подписанной ссылке.
export async function up(pgm) {
  pgm.sql(`
    create table if not exists lab_files (
      id serial primary key,
      user_id integer not null references users(id) on delete cascade,
      taken_on date not null,
      title text,
      mime text not null,
      size_bytes integer not null,
      stored_name text not null,
      original_name text,
      created_at timestamptz not null default now()
    );
    create index if not exists lab_files_user_idx on lab_files(user_id, taken_on desc);
  `);
}

export async function down(pgm) {
  pgm.sql(`drop table if exists lab_files;`);
}
