import { pool } from "./db.js";

const ANALYSIS_VERSION = 1;
const MIN_DISTANCE_METERS = 3000;
const MIN_MOVING_TIME_SECONDS = 12 * 60;
const MIN_STREAM_POINTS = 60;
const MIN_PACE_SECONDS_PER_KM = 160;
const MAX_PACE_SECONDS_PER_KM = 510;
const MAX_SUMMARY_STREAM_DISTANCE_DELTA = 0.05;
const MAX_SEGMENT_SPEED_MPS = 12;
const BAD_SEGMENT_SPEED_MPS = 9;
const MAX_BAD_SEGMENT_RATIO = 0.02;
const MAX_ELEVATION_GAIN_PER_KM = 50;

type WorkoutAnalysisStatus = "reliable" | "unreliable" | "skipped";

type WorkoutAnalysisInput = {
  workout_id: number;
  sport_type: string;
  user_id: number;
  distance_meters: number | string;
  moving_time_seconds: number | string;
  elevation_gain: number | string;
  average_heartrate: number | string | null;
  workout_created_at: Date;
  correction_kind: string | null;
  correction_updated_at: Date | null;
  streams_fetched_at: Date | null;
  distance_stream: unknown;
  time_stream: unknown;
};

type EstimatedHrMaxRow = {
  estimated_hrmax: number | string | null;
};

function toFiniteNumber(value: unknown, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function numericArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === "number" && Number.isFinite(item))
    : [];
}

function getSourceUpdatedAt(row: WorkoutAnalysisInput) {
  const candidates = [row.workout_created_at, row.correction_updated_at, row.streams_fetched_at]
    .filter((value): value is Date => value instanceof Date && Number.isFinite(value.getTime()));

  return new Date(Math.max(...candidates.map((value) => value.getTime())));
}

async function getEstimatedHrMax(userId: number) {
  const { rows } = await pool.query<EstimatedHrMaxRow>(
    `
      select percentile_cont(0.95) within group(order by max_heartrate) + 3 as estimated_hrmax
      from workouts
      where user_id = $1
        and sport_type = 'Run'
        and max_heartrate between 120 and 230
    `,
    [userId]
  );

  const estimated = Number(rows[0]?.estimated_hrmax ?? NaN);
  return Number.isFinite(estimated) ? estimated : null;
}

function checkStreamQuality(distanceStream: number[], timeStream: number[], summaryDistanceMeters: number) {
  if (distanceStream.length < MIN_STREAM_POINTS || timeStream.length < MIN_STREAM_POINTS) {
    return { ok: false, reason: "stream_too_short" };
  }

  const size = Math.min(distanceStream.length, timeStream.length);
  const streamDistance = distanceStream[size - 1]! - distanceStream[0]!;
  if (!Number.isFinite(streamDistance) || streamDistance <= 0) {
    return { ok: false, reason: "invalid_stream_distance" };
  }

  const distanceDelta = Math.abs(streamDistance - summaryDistanceMeters) / summaryDistanceMeters;
  if (distanceDelta > MAX_SUMMARY_STREAM_DISTANCE_DELTA) {
    return { ok: false, reason: "stream_distance_mismatch" };
  }

  let checkedSegments = 0;
  let badSegments = 0;
  let maxSegmentSpeed = 0;

  for (let index = 1; index < size; index += 1) {
    const dt = timeStream[index]! - timeStream[index - 1]!;
    const dd = distanceStream[index]! - distanceStream[index - 1]!;
    if (!Number.isFinite(dt) || !Number.isFinite(dd) || dt <= 0) {
      continue;
    }

    // Strava distance streams can contain tiny negative jitter; large backtracks point to bad GPS.
    if (dd < -5) {
      badSegments += 1;
      checkedSegments += 1;
      continue;
    }

    const speed = Math.max(0, dd) / dt;
    maxSegmentSpeed = Math.max(maxSegmentSpeed, speed);
    if (speed > BAD_SEGMENT_SPEED_MPS) {
      badSegments += 1;
    }
    checkedSegments += 1;
  }

  if (maxSegmentSpeed > MAX_SEGMENT_SPEED_MPS) {
    return { ok: false, reason: "segment_speed_spike" };
  }

  const badSegmentRatio = checkedSegments > 0 ? badSegments / checkedSegments : 1;
  if (badSegmentRatio > MAX_BAD_SEGMENT_RATIO) {
    return { ok: false, reason: "too_many_bad_segments" };
  }

  return { ok: true, reason: "reliable" };
}

function buildSkippedAnalysis(reason: string, row: WorkoutAnalysisInput, estimatedHrMax: number | null) {
  return {
    status: "skipped" as const,
    reason,
    fitnessScore: null,
    aerobicScore: null,
    estimatedHrMax,
    elevationAdjustedSpeed: null,
    elevationGainPerKm: null,
    sourceUpdatedAt: getSourceUpdatedAt(row)
  };
}

function buildUnreliableAnalysis(reason: string, row: WorkoutAnalysisInput, estimatedHrMax: number | null) {
  return {
    status: "unreliable" as const,
    reason,
    fitnessScore: null,
    aerobicScore: null,
    estimatedHrMax,
    elevationAdjustedSpeed: null,
    elevationGainPerKm: null,
    sourceUpdatedAt: getSourceUpdatedAt(row)
  };
}

async function calculateWorkoutAnalysis(row: WorkoutAnalysisInput) {
  const estimatedHrMax = await getEstimatedHrMax(row.user_id);
  const distanceMeters = toFiniteNumber(row.distance_meters);
  const movingTimeSeconds = toFiniteNumber(row.moving_time_seconds);
  const elevationGain = toFiniteNumber(row.elevation_gain);
  const averageHeartrate = Number(row.average_heartrate ?? NaN);

  if (row.sport_type !== "Run") {
    return buildSkippedAnalysis("not_run", row, estimatedHrMax);
  }
  if (row.correction_kind) {
    return buildSkippedAnalysis(`has_correction:${row.correction_kind}`, row, estimatedHrMax);
  }
  if (distanceMeters < MIN_DISTANCE_METERS) {
    return buildSkippedAnalysis("distance_too_short", row, estimatedHrMax);
  }
  if (movingTimeSeconds < MIN_MOVING_TIME_SECONDS) {
    return buildSkippedAnalysis("time_too_short", row, estimatedHrMax);
  }
  if (!estimatedHrMax || estimatedHrMax < 120 || estimatedHrMax > 230) {
    return buildSkippedAnalysis("hrmax_unavailable", row, estimatedHrMax);
  }
  if (!Number.isFinite(averageHeartrate) || averageHeartrate < 90 || averageHeartrate > 220) {
    return buildSkippedAnalysis("heartrate_unavailable", row, estimatedHrMax);
  }

  const paceSecondsPerKm = movingTimeSeconds / (distanceMeters / 1000);
  if (paceSecondsPerKm < MIN_PACE_SECONDS_PER_KM || paceSecondsPerKm > MAX_PACE_SECONDS_PER_KM) {
    return buildSkippedAnalysis("pace_out_of_range", row, estimatedHrMax);
  }

  const distanceStream = numericArray(row.distance_stream);
  const timeStream = numericArray(row.time_stream);
  const streamQuality = checkStreamQuality(distanceStream, timeStream, distanceMeters);
  if (!streamQuality.ok) {
    return buildUnreliableAnalysis(streamQuality.reason, row, estimatedHrMax);
  }

  const elevationGainPerKm = elevationGain / (distanceMeters / 1000);
  if (!Number.isFinite(elevationGainPerKm) || elevationGainPerKm > MAX_ELEVATION_GAIN_PER_KM) {
    return buildSkippedAnalysis("elevation_too_high", row, estimatedHrMax);
  }

  const excessGainMeters = Math.max(elevationGain - (distanceMeters / 1000) * 10, 0);
  const adjustedSeconds = Math.max(
    movingTimeSeconds * 0.88,
    movingTimeSeconds - Math.min(excessGainMeters * 0.6, movingTimeSeconds * 0.12)
  );
  const elevationAdjustedSpeed = distanceMeters / adjustedSeconds;
  const heartRateFraction = averageHeartrate / estimatedHrMax;

  if (heartRateFraction < 0.58 || heartRateFraction > 0.98) {
    return buildSkippedAnalysis("heartrate_fraction_out_of_range", row, estimatedHrMax);
  }

  const fitnessScore = elevationAdjustedSpeed / heartRateFraction;
  const aerobicScore =
    heartRateFraction >= 0.68 && heartRateFraction <= 0.88 ? fitnessScore : null;

  return {
    status: "reliable" as const,
    reason: "reliable",
    fitnessScore,
    aerobicScore,
    estimatedHrMax,
    elevationAdjustedSpeed,
    elevationGainPerKm,
    sourceUpdatedAt: getSourceUpdatedAt(row)
  };
}

async function upsertAnalysis(workoutId: number, analysis: Awaited<ReturnType<typeof calculateWorkoutAnalysis>>) {
  await pool.query(
    `
      insert into workout_analysis (
        workout_id,
        analysis_version,
        gps_quality_status,
        gps_quality_reason,
        fitness_score,
        aerobic_score,
        estimated_hrmax,
        elevation_adjusted_speed,
        elevation_gain_per_km,
        source_updated_at,
        analyzed_at
      )
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
      on conflict (workout_id) do update
      set analysis_version = excluded.analysis_version,
          gps_quality_status = excluded.gps_quality_status,
          gps_quality_reason = excluded.gps_quality_reason,
          fitness_score = excluded.fitness_score,
          aerobic_score = excluded.aerobic_score,
          estimated_hrmax = excluded.estimated_hrmax,
          elevation_adjusted_speed = excluded.elevation_adjusted_speed,
          elevation_gain_per_km = excluded.elevation_gain_per_km,
          source_updated_at = excluded.source_updated_at,
          analyzed_at = now()
    `,
    [
      workoutId,
      ANALYSIS_VERSION,
      analysis.status satisfies WorkoutAnalysisStatus,
      analysis.reason,
      analysis.fitnessScore,
      analysis.aerobicScore,
      analysis.estimatedHrMax,
      analysis.elevationAdjustedSpeed,
      analysis.elevationGainPerKm,
      analysis.sourceUpdatedAt.toISOString()
    ]
  );
}

export async function analyzeWorkout(workoutId: number) {
  const { rows } = await pool.query<WorkoutAnalysisInput>(
    `
      select
        w.id as workout_id,
        w.sport_type,
        w.user_id,
        w.distance_meters,
        w.moving_time_seconds,
        w.elevation_gain,
        w.average_heartrate,
        w.created_at as workout_created_at,
        wc.kind as correction_kind,
        wc.updated_at as correction_updated_at,
        ws.fetched_at as streams_fetched_at,
        ws.distance_stream,
        ws.time_stream
      from workouts w
      left join workout_corrections wc on wc.workout_id = w.id
      left join workout_streams ws on ws.workout_id = w.id
      where w.id = $1
    `,
    [workoutId]
  );

  const row = rows[0];
  if (!row) {
    return null;
  }

  const analysis = await calculateWorkoutAnalysis(row);
  await upsertAnalysis(workoutId, analysis);

  return {
    workoutId,
    ...analysis
  };
}

export async function analyzeStaleWorkouts(limit = 50) {
  const { rows } = await pool.query<{ id: number }>(
    `
      select w.id
      from workouts w
      left join workout_corrections wc on wc.workout_id = w.id
      left join workout_streams ws on ws.workout_id = w.id
      left join workout_analysis wa on wa.workout_id = w.id
      where w.sport_type = 'Run'
        and (
          wa.workout_id is null
          or wa.analysis_version < $2
          or wa.source_updated_at < greatest(
            w.created_at,
            coalesce(wc.updated_at, w.created_at),
            coalesce(ws.fetched_at, w.created_at)
          )
        )
      order by w.start_date desc
      limit $1
    `,
    [limit, ANALYSIS_VERSION]
  );

  let analyzed = 0;
  for (const row of rows) {
    await analyzeWorkout(row.id);
    analyzed += 1;
  }

  return { selected: rows.length, analyzed };
}
