export async function up(pgm) {
  pgm.sql(`
    create table if not exists workout_analysis (
      workout_id integer primary key references workouts(id) on delete cascade,
      analysis_version integer not null default 1,
      gps_quality_status text not null,
      gps_quality_reason text not null,
      fitness_score double precision,
      aerobic_score double precision,
      estimated_hrmax double precision,
      elevation_adjusted_speed double precision,
      elevation_gain_per_km double precision,
      source_updated_at timestamptz not null,
      analyzed_at timestamptz not null default now(),
      constraint workout_analysis_status_check
        check (gps_quality_status in ('reliable', 'unreliable', 'skipped'))
    );
  `);

  pgm.sql(`
    create index if not exists workout_analysis_status_score_idx
      on workout_analysis(gps_quality_status, fitness_score desc);
  `);
}

export async function down(pgm) {
  pgm.sql(`drop table if exists workout_analysis;`);
}
