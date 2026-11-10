// 1) Переписка тренера и спортсмена под пробежкой — личная (is_private), её видят только они.
//    Комментарии одногруппников остаются общими. Уже написанное тренером в обсуждении — личное.
// 2) День рождения: только день и месяц (год не храним), клубу виден, пока спортсмен не скрыл.
export async function up(pgm) {
  pgm.sql(`
    alter table workout_comments add column if not exists is_private boolean not null default false;
    update workout_comments c set is_private = true
      from workouts w join users a on a.id = w.user_id
      where c.workout_id = w.id and c.author_id = a.coach_id;
    alter table users add column if not exists birthday_day smallint,
      add column if not exists birthday_month smallint,
      add column if not exists birthday_hidden boolean not null default false,
      add column if not exists birthday_notified_on date;
  `);
}

export async function down(pgm) {
  pgm.sql(`
    alter table workout_comments drop column if exists is_private;
    alter table users drop column if exists birthday_day, drop column if exists birthday_month,
      drop column if exists birthday_hidden, drop column if exists birthday_notified_on;
  `);
}
