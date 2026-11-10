// Личные заметки тренера о спортсмене (травмы, ограничения, цели). Видит только тренер
export async function up(pgm) {
  pgm.sql(`
    create table if not exists coach_notes (
      athlete_id integer not null references users(id) on delete cascade,
      coach_id integer not null references users(id) on delete cascade,
      body text not null default '',
      updated_at timestamptz not null default now(),
      primary key (athlete_id, coach_id)
    );
  `);
}

export async function down(pgm) {
  pgm.sql(`drop table if exists coach_notes;`);
}
