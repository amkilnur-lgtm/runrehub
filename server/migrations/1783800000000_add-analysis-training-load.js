export async function up(pgm) {
  pgm.sql(`alter table workout_analysis add column if not exists training_load double precision;`);
}

export async function down(pgm) {
  pgm.sql(`alter table workout_analysis drop column if exists training_load;`);
}
