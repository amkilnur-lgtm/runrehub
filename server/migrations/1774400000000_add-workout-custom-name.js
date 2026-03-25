export async function up(knex) {
  await knex.raw(`
    alter table workouts
    add column if not exists strava_name text,
    add column if not exists custom_name text;
  `);

  await knex.raw(`
    update workouts
    set strava_name = coalesce(strava_name, name),
        custom_name = coalesce(custom_name, name)
    where strava_name is null
       or custom_name is null;
  `);
}

export async function down(knex) {
  await knex.raw(`
    alter table workouts
    drop column if exists custom_name,
    drop column if exists strava_name;
  `);
}
