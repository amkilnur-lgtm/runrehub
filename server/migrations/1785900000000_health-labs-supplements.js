// «Здоровье» в «Моём профиле»: анализы (каждая сдача — дата и значения) и витамины/добавки.
// Видят спортсмен и, если он не выключил, тренер. Одногруппникам — никогда.
export async function up(pgm) {
  pgm.sql(`
    alter table users add column if not exists health_consent_at timestamptz,
      add column if not exists health_share_coach boolean not null default true;
    create table if not exists lab_results (
      id serial primary key,
      user_id integer not null references users(id) on delete cascade,
      taken_on date not null,
      marker text not null,
      value numeric not null,
      unit text,
      created_at timestamptz not null default now()
    );
    create index if not exists lab_results_user_idx on lab_results(user_id, taken_on desc);
    create table if not exists supplements (
      id serial primary key,
      user_id integer not null references users(id) on delete cascade,
      name text not null,
      dose text,
      started_on date not null default current_date,
      stopped_on date,
      created_at timestamptz not null default now()
    );
    create index if not exists supplements_user_idx on supplements(user_id);
  `);
}

export async function down(pgm) {
  pgm.sql(`
    drop table if exists supplements; drop table if exists lab_results;
    alter table users drop column if exists health_consent_at, drop column if exists health_share_coach;
  `);
}
