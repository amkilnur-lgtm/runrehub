export async function up(pgm) {
  pgm.sql(`
    create table if not exists workout_likes (
      workout_id integer not null references workouts(id) on delete cascade,
      user_id integer not null references users(id) on delete cascade,
      created_at timestamptz not null default now(),
      primary key (workout_id, user_id)
    );
    create index if not exists workout_likes_workout_idx on workout_likes(workout_id);
    create index if not exists workout_likes_user_idx on workout_likes(user_id);
  `);
}

export async function down(pgm) {
  pgm.sql(`drop table if exists workout_likes;`);
}
