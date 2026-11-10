// «Мой профиль · видно клубу»: о себе, разряд ЕВСК, достижения, метка «Восстанавливаюсь».
// Медицинских данных здесь нет — только то, что спортсмен сам показывает клубу.
export async function up(pgm) {
  pgm.sql(`
    alter table users add column if not exists about text,
      add column if not exists sport_rank text,
      add column if not exists sport_rank_discipline text,
      add column if not exists sport_rank_year smallint,
      add column if not exists recovering boolean not null default false;
    create table if not exists athlete_achievements (
      id serial primary key,
      user_id integer not null references users(id) on delete cascade,
      title text not null,
      year smallint,
      created_at timestamptz not null default now()
    );
    create index if not exists athlete_achievements_user_idx on athlete_achievements(user_id);
  `);
}

export async function down(pgm) {
  pgm.sql(`
    drop table if exists athlete_achievements;
    alter table users drop column if exists about, drop column if exists sport_rank,
      drop column if exists sport_rank_discipline, drop column if exists sport_rank_year, drop column if exists recovering;
  `);
}
