// Цикл в «Здоровье»: по умолчанию выключен; тренеру — отдельным тумблером, тоже выключенным.
// Храним только даты начала (и по желанию конца) месячных — без симптомов и диагнозов.
export async function up(pgm) {
  pgm.sql(`
    alter table users add column if not exists cycle_enabled boolean not null default false,
      add column if not exists cycle_share_coach boolean not null default false,
      add column if not exists cycle_hormonal boolean not null default false;
    create table if not exists cycle_periods (
      id serial primary key,
      user_id integer not null references users(id) on delete cascade,
      started_on date not null,
      ended_on date,
      created_at timestamptz not null default now(),
      unique (user_id, started_on)
    );
  `);
}

export async function down(pgm) {
  pgm.sql(`
    drop table if exists cycle_periods;
    alter table users drop column if exists cycle_enabled, drop column if exists cycle_share_coach, drop column if exists cycle_hormonal;
  `);
}
