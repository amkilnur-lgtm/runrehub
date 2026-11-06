// Вход в Mini App через Telegram: админ заранее вписывает ник, при первом входе
// по совпадению ника запоминаем числовой id Telegram, дальше входим только по id
export async function up(pgm) {
  pgm.sql(`
    alter table users add column if not exists telegram_username text;
    alter table users add column if not exists telegram_user_id bigint;
    create unique index if not exists users_telegram_username_key on users (lower(telegram_username));
    create unique index if not exists users_telegram_user_id_key on users (telegram_user_id);
  `);
}

export async function down(pgm) {
  pgm.sql(`
    drop index if exists users_telegram_user_id_key;
    drop index if exists users_telegram_username_key;
    alter table users drop column if exists telegram_user_id;
    alter table users drop column if exists telegram_username;
  `);
}
