// Самочувствие после пробежки: как ощущалось и была ли боль. Личная отметка спортсмена,
// видят только он и тренер (отдельно от переписки, как Private Notes в TrainingPeaks)
export async function up(pgm) {
  pgm.sql(`
    create table if not exists workout_feelings (
      workout_id integer primary key references workouts(id) on delete cascade,
      user_id integer not null references users(id) on delete cascade,
      effort text check (effort in ('easy', 'normal', 'hard')),
      pain text check (pain in ('none', 'light')),
      updated_at timestamptz not null default now()
    );
    create index if not exists workout_feelings_user_idx on workout_feelings (user_id, updated_at desc);
  `);
}

export async function down(pgm) {
  pgm.sql(`drop table if exists workout_feelings;`);
}
