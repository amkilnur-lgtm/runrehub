// Удаление тренера падало на FK: правки GPS/дистанции/времени ссылались на него
// с on delete restrict. Правка принадлежит тренировке, автор — справочно.
export async function up(pgm) {
  pgm.sql(`
    alter table workout_corrections
      alter column created_by_user_id drop not null,
      drop constraint if exists workout_corrections_created_by_user_id_fkey,
      add constraint workout_corrections_created_by_user_id_fkey
        foreign key (created_by_user_id) references users(id) on delete set null;
  `);
}

export async function down(pgm) {
  pgm.sql(`
    alter table workout_corrections
      drop constraint if exists workout_corrections_created_by_user_id_fkey,
      add constraint workout_corrections_created_by_user_id_fkey
        foreign key (created_by_user_id) references users(id) on delete restrict;
  `);
}
