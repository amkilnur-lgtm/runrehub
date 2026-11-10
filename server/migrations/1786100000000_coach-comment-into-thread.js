// Одна переписка: «комментарий тренера» становится первым личным сообщением тренера в переписке
// по пробежке. Дубли (тот же текст уже есть сообщением тренера) не создаём. Поле очищаем.
export async function up(pgm) {
  pgm.sql(`
    insert into workout_comments (workout_id, author_id, body, is_private, created_at)
    select w.id, a.coach_id, btrim(w.coach_comment), true,
           coalesce(
             w.coach_comment_updated_at,
             (select min(c.created_at) - interval '1 second' from workout_comments c where c.workout_id = w.id and c.is_private),
             w.start_date + interval '3 hours'
           )
    from workouts w
    join users a on a.id = w.user_id
    where nullif(btrim(w.coach_comment), '') is not null
      and a.coach_id is not null
      and not exists (
        select 1 from workout_comments c
        where c.workout_id = w.id and c.author_id = a.coach_id and btrim(c.body) = btrim(w.coach_comment)
      );
    update workouts set coach_comment = null where coach_comment is not null;
  `);
}

export async function down() {}
