export async function up(pgm) {
  pgm.sql(`
    create table if not exists workout_comments (
      id serial primary key,
      workout_id integer not null references workouts(id) on delete cascade,
      author_id integer not null references users(id) on delete cascade,
      body text not null,
      created_at timestamptz not null default now()
    );
    create index if not exists workout_comments_workout_idx on workout_comments(workout_id, created_at);
  `);
}

export async function down(pgm) {
  pgm.sql(`drop table if exists workout_comments;`);
}
