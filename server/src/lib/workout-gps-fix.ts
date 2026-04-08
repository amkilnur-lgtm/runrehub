import { pool } from "./db.js";
import type { ActivityStreams } from "./strava.js";

type WorkoutSummary = {
  id: number;
  sport_type: string;
  distance_meters: number;
  moving_time_seconds: number;
  elapsed_time_seconds: number;
  elevation_gain: number;
  average_speed: number | null;
  average_heartrate: number | null;
  max_heartrate: number | null;
};

type WorkoutSummaryLike = Pick<
  WorkoutSummary,
  | "distance_meters"
  | "moving_time_seconds"
  | "elapsed_time_seconds"
  | "elevation_gain"
  | "average_speed"
  | "average_heartrate"
  | "max_heartrate"
>;

type WorkoutLapRow = {
  id: number;
  name: string | null;
  distance_meters: number;
  elapsed_time_seconds: number;
  average_speed: number | null;
  average_heartrate: number | null;
  elevation_gain: number | null;
  start_index: number | null;
  end_index: number | null;
};

type AthleteCadenceProfileBin = {
  cadence: number;
  median_pace_seconds_per_km: number;
  median_heartrate: number | null;
  sample_count: number;
};

export type AthleteCadenceProfile = {
  bins: AthleteCadenceProfileBin[];
  median_pace_seconds_per_km: number | null;
  median_heartrate: number | null;
  sample_count: number;
};

type RemovedSegment = {
  startIndex: number;
  endIndex: number;
  removedDistanceMeters: number;
  removedTimeSeconds: number;
  peakSpeedMetersPerSecond: number;
};

type ManualDistanceMetadata = {
  target_distance_meters: number;
  source_distance_meters: number;
  scale_factor: number;
  split_strategy: SplitStrategy;
};

type ManualTimeMetadata = {
  target_moving_time_seconds: number;
  source_moving_time_seconds: number;
  scale_factor: number;
  split_strategy: SplitStrategy;
};

type SplitStrategy = "stream" | "synthetic_even";

type CorrectedStreamsPayload = {
  distance: number[];
  time: number[];
  heartrate: number[];
  cadence: number[];
  altitude: number[];
  velocity_smooth: number[];
  latlng: [number, number][];
};

type CorrectedLapPayload = {
  id: number;
  name: string | null;
  distance_meters: number;
  elapsed_time_seconds: number;
  average_speed: number | null;
  average_heartrate: number | null;
  elevation_gain: number | null;
};

type GpsFixPreview = {
  removedSegments: RemovedSegment[];
  correctedWorkout: {
    distance_meters: number;
    moving_time_seconds: number;
    elapsed_time_seconds: number;
    elevation_gain: number;
    average_speed: number | null;
    average_heartrate: number | null;
    max_heartrate: number | null;
  };
  correctedStreams: CorrectedStreamsPayload;
  correctedLaps: CorrectedLapPayload[];
};

type ManualDistancePreview = {
  correctedWorkout: {
    distance_meters: number;
    moving_time_seconds: number;
    elapsed_time_seconds: number;
    elevation_gain: number;
    average_speed: number | null;
    average_heartrate: number | null;
    max_heartrate: number | null;
  };
  correctedStreams: CorrectedStreamsPayload;
  correctedLaps: CorrectedLapPayload[];
  metadata: ManualDistanceMetadata;
};

type ManualTimePreview = {
  correctedWorkout: {
    distance_meters: number;
    moving_time_seconds: number;
    elapsed_time_seconds: number;
    elevation_gain: number;
    average_speed: number | null;
    average_heartrate: number | null;
    max_heartrate: number | null;
  };
  correctedStreams: CorrectedStreamsPayload;
  correctedLaps: CorrectedLapPayload[];
  metadata: ManualTimeMetadata;
};

export type WorkoutCorrectionPreview = GpsFixPreview | ManualDistancePreview | ManualTimePreview;
export type WorkoutCorrectionKind = "gps_autofix" | "manual_distance" | "manual_time";

type StoredCorrectionRow = {
  workout_id: number;
  kind: WorkoutCorrectionKind;
  corrected_distance_meters: number;
  corrected_moving_time_seconds: number;
  corrected_elapsed_time_seconds: number;
  corrected_elevation_gain: number;
  corrected_average_speed: number | null;
  corrected_average_heartrate: number | null;
  corrected_max_heartrate: number | null;
  removed_segments: RemovedSegment[] | null;
  corrected_streams: CorrectedStreamsPayload | null;
  corrected_laps: CorrectedLapPayload[] | null;
  created_by_user_id: number;
  created_at: string;
  updated_at: string;
};

const MAX_RUN_SPEED_MPS = 8.5;
const MAX_GEO_SPEED_MPS = 10.5;
const MAX_STEP_DISTANCE_METERS = 120;
const MAX_STEP_GEO_DISTANCE_METERS = 150;
const MIN_REMOVAL_DISTANCE_METERS = 25;
const MAX_SUSPECT_GAP = 2;
const MAX_REALISTIC_CADENCE = 230;
const MAX_NORMAL_CADENCE = 205;
const HIGH_INTENSITY_HR_FRACTION = 0.88;
const MIN_MANUAL_DISTANCE_METERS = 200;
const MAX_MANUAL_DISTANCE_METERS = 500000;
const MIN_MANUAL_TIME_SECONDS = 60;
const MAX_MANUAL_TIME_SECONDS = 60 * 60 * 24;
const SPLIT_DISTANCE_METERS = 1000;
const MIN_REALISTIC_SPLIT_PACE_SECONDS = 150;
const MIN_STREAM_SPLIT_DISTANCE_METERS = 3000;
const PROFILE_MIN_CADENCE = 110;
const PROFILE_MAX_CADENCE = 220;
const PROFILE_MIN_SEGMENT_SECONDS = 2;
const PROFILE_MAX_SEGMENT_SECONDS = 20;
const PROFILE_MAX_SEGMENT_DISTANCE_METERS = 120;
const PROFILE_MIN_PACE_SECONDS = 160;
const PROFILE_MAX_PACE_SECONDS = 900;
const PROFILE_BIN_SIZE = 5;
const PROFILE_MIN_TOTAL_SAMPLES = 12;
const PROFILE_MIN_BIN_SAMPLES = 3;
const PROFILE_FAST_MISMATCH_FACTOR = 1.85;
const PROFILE_STRONG_FAST_MISMATCH_FACTOR = 2.3;
const PROFILE_WHOLE_WORKOUT_MISMATCH_RATIO = 0.42;
const PROFILE_MIN_COMPARABLE_SAMPLES = 4;
const PROFILE_PRIMARY_WHOLE_WORKOUT_RATIO = 0.25;
const PROFILE_AVERAGE_PACE_OVERRIDE_FACTOR = 0.72;
const PROFILE_ABSURD_PACE_OVERRIDE_SECONDS = 120;
const PROFILE_ABSURD_SPEED_OVERRIDE_MPS = 10;

function toFiniteNumber(value: number | null | undefined, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function haversineMeters(a: [number, number], b: [number, number]) {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadius = 6371000;
  const dLat = toRadians(b[0] - a[0]);
  const dLng = toRadians(b[1] - a[1]);
  const lat1 = toRadians(a[0]);
  const lat2 = toRadians(b[0]);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;

  return 2 * earthRadius * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function computePositiveElevationGain(altitude: number[]) {
  let total = 0;
  for (let index = 1; index < altitude.length; index += 1) {
    const delta = altitude[index] - altitude[index - 1];
    if (Number.isFinite(delta) && delta > 0) {
      total += delta;
    }
  }
  return total;
}

function computeAverageHeartRate(heartrate: number[]) {
  const valid = heartrate.filter((value) => Number.isFinite(value) && value > 0);
  if (!valid.length) {
    return null;
  }

  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function median(values: number[]) {
  if (!values.length) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1]! + sorted[middle]!) / 2;
  }

  return sorted[middle]!;
}

function interpolateValue(
  startDistance: number,
  endDistance: number,
  startValue: number,
  endValue: number,
  targetDistance: number
) {
  const span = endDistance - startDistance;
  if (!Number.isFinite(span) || span <= 0) {
    return endValue;
  }

  const ratio = (targetDistance - startDistance) / span;
  return startValue + (endValue - startValue) * ratio;
}

function timeAtDistance(distance: number[], time: number[], targetDistance: number) {
  if (!distance.length || !time.length) {
    return 0;
  }

  if (targetDistance <= distance[0]) {
    return time[0] ?? 0;
  }

  const lastIndex = Math.min(distance.length, time.length) - 1;
  if (targetDistance >= distance[lastIndex]) {
    return time[lastIndex] ?? 0;
  }

  for (let index = 1; index <= lastIndex; index += 1) {
    const previousDistance = toFiniteNumber(distance[index - 1]);
    const currentDistance = toFiniteNumber(distance[index]);
    if (targetDistance > currentDistance) {
      continue;
    }

    return interpolateValue(
      previousDistance,
      currentDistance,
      toFiniteNumber(time[index - 1]),
      toFiniteNumber(time[index]),
      targetDistance
    );
  }

  return time[lastIndex] ?? 0;
}

function collectIndicesForDistanceRange(distance: number[], startDistance: number, endDistance: number) {
  const indices: number[] = [];

  for (let index = 0; index < distance.length; index += 1) {
    const currentDistance = toFiniteNumber(distance[index]);
    if (currentDistance >= startDistance && currentDistance <= endDistance) {
      indices.push(index);
    }
  }

  return indices;
}

function buildKilometerSplits(streams: CorrectedStreamsPayload) {
  const totalDistance = toFiniteNumber(streams.distance[streams.distance.length - 1]);
  const totalTime = toFiniteNumber(streams.time[streams.time.length - 1]);
  if (totalDistance <= 0 || totalTime <= 0) {
    return [] as CorrectedLapPayload[];
  }

  const splits: CorrectedLapPayload[] = [];
  let lapIndex = 1;
  let startDistance = 0;
  let startTime = 0;

  while (startDistance < totalDistance - 1e-6) {
    const endDistance = Math.min(startDistance + SPLIT_DISTANCE_METERS, totalDistance);
    const endTime = timeAtDistance(streams.distance, streams.time, endDistance);
    const elapsedTimeSeconds = Math.max(0, endTime - startTime);
    const distanceMeters = Math.max(0, endDistance - startDistance);

    if (distanceMeters <= 0 || elapsedTimeSeconds <= 0) {
      break;
    }

    const splitIndices = collectIndicesForDistanceRange(streams.distance, startDistance, endDistance);
    const heartRates = splitIndices
      .map((index) => streams.heartrate[index])
      .filter((value) => Number.isFinite(value) && value > 0);
    const altitude = splitIndices
      .map((index) => streams.altitude[index])
      .filter((value) => Number.isFinite(value));

    splits.push({
      id: lapIndex,
      name: null,
      distance_meters: distanceMeters,
      elapsed_time_seconds: Math.round(elapsedTimeSeconds),
      average_speed: distanceMeters / elapsedTimeSeconds,
      average_heartrate: heartRates.length
        ? heartRates.reduce((sum, value) => sum + value, 0) / heartRates.length
        : null,
      elevation_gain: altitude.length ? computePositiveElevationGain(altitude) : null
    });

    lapIndex += 1;
    startDistance = endDistance;
    startTime = endTime;
  }

  return splits;
}

function buildSyntheticEvenKilometerSplits(
  workout: WorkoutSummaryLike,
  streams: ActivityStreams | CorrectedStreamsPayload | null,
  totalDistanceMeters: number,
  totalMovingTimeSeconds: number
) {
  if (totalDistanceMeters <= 0 || totalMovingTimeSeconds <= 0) {
    return [] as CorrectedLapPayload[];
  }

  const splitCount = Math.ceil(totalDistanceMeters / SPLIT_DISTANCE_METERS);
  const validHeartRates =
    streams?.heartrate?.filter((value) => Number.isFinite(value) && value > 0) ?? [];
  const averageHeartRate = validHeartRates.length
    ? validHeartRates.reduce((sum, value) => sum + value, 0) / validHeartRates.length
    : toFiniteNumber(workout.average_heartrate, NaN);
  const totalElevationGain = Math.max(0, toFiniteNumber(workout.elevation_gain));
  const laps: CorrectedLapPayload[] = [];
  let assignedTimeSeconds = 0;

  for (let index = 0; index < splitCount; index += 1) {
    const remainingDistanceMeters = Math.max(
      0,
      totalDistanceMeters - index * SPLIT_DISTANCE_METERS
    );
    const distanceMeters = Math.min(SPLIT_DISTANCE_METERS, remainingDistanceMeters);
    if (distanceMeters <= 0) {
      break;
    }

    const remainingSplits = splitCount - index;
    const rawSplitTime =
      index === splitCount - 1
        ? totalMovingTimeSeconds - assignedTimeSeconds
        : (totalMovingTimeSeconds * distanceMeters) / totalDistanceMeters;
    const elapsedTimeSeconds = Math.max(
      1,
      remainingSplits === 1
        ? totalMovingTimeSeconds - assignedTimeSeconds
        : Math.round(rawSplitTime)
    );
    assignedTimeSeconds += elapsedTimeSeconds;

    laps.push({
      id: index + 1,
      name: null,
      distance_meters: distanceMeters,
      elapsed_time_seconds: elapsedTimeSeconds,
      average_speed: elapsedTimeSeconds > 0 ? distanceMeters / elapsedTimeSeconds : null,
      average_heartrate: Number.isFinite(averageHeartRate) ? averageHeartRate : null,
      elevation_gain:
        totalElevationGain > 0
          ? (totalElevationGain * distanceMeters) / totalDistanceMeters
          : null
    });
  }

  if (laps.length) {
    const totalAssigned = laps.reduce((sum, lap) => sum + lap.elapsed_time_seconds, 0);
    const delta = totalMovingTimeSeconds - totalAssigned;
    if (delta !== 0) {
      const lastLap = laps[laps.length - 1]!;
      lastLap.elapsed_time_seconds = Math.max(1, lastLap.elapsed_time_seconds + delta);
      lastLap.average_speed =
        lastLap.elapsed_time_seconds > 0
          ? lastLap.distance_meters / lastLap.elapsed_time_seconds
          : null;
    }
  }

  return laps;
}

function chooseSplitStrategy(
  workout: WorkoutSummaryLike,
  streams: CorrectedStreamsPayload
): SplitStrategy {
  const totalDistanceMeters = toFiniteNumber(streams.distance[streams.distance.length - 1]);
  const totalMovingTimeSeconds = toFiniteNumber(streams.time[streams.time.length - 1]);
  if (
    totalDistanceMeters < MIN_STREAM_SPLIT_DISTANCE_METERS ||
    totalMovingTimeSeconds <= 0
  ) {
    return "stream";
  }

  const splits = buildKilometerSplits(streams);
  if (!splits.length) {
    return "synthetic_even";
  }

  const unrealisticFastSplits = splits.filter((lap) => {
    if (lap.distance_meters < SPLIT_DISTANCE_METERS * 0.9 || lap.elapsed_time_seconds <= 0) {
      return false;
    }

    const paceSeconds = (lap.elapsed_time_seconds / lap.distance_meters) * SPLIT_DISTANCE_METERS;
    return Number.isFinite(paceSeconds) && paceSeconds < MIN_REALISTIC_SPLIT_PACE_SECONDS;
  }).length;

  const overallAverageSpeed =
    totalMovingTimeSeconds > 0 ? totalDistanceMeters / totalMovingTimeSeconds : null;
  const overallPaceSeconds =
    overallAverageSpeed && overallAverageSpeed > 0
      ? SPLIT_DISTANCE_METERS / overallAverageSpeed
      : null;

  if (unrealisticFastSplits > 0) {
    return "synthetic_even";
  }

  if (
    overallPaceSeconds !== null &&
    overallPaceSeconds < MIN_REALISTIC_SPLIT_PACE_SECONDS &&
    !Number.isFinite(workout.average_heartrate)
  ) {
    return "synthetic_even";
  }

  return "stream";
}

function buildCorrectedSplits(
  workout: WorkoutSummaryLike,
  correctedStreams: CorrectedStreamsPayload,
  totalDistanceMeters: number,
  totalMovingTimeSeconds: number
) {
  const splitStrategy = chooseSplitStrategy(workout, correctedStreams);
  return {
    splitStrategy,
    correctedLaps:
      splitStrategy === "stream"
        ? buildKilometerSplits(correctedStreams)
        : buildSyntheticEvenKilometerSplits(
            workout,
            correctedStreams,
            totalDistanceMeters,
            totalMovingTimeSeconds
          )
  };
}

function estimatePaceFromProfile(
  profile: AthleteCadenceProfile | null,
  cadence: number,
  heartrate: number
) {
  if (!profile || profile.sample_count < PROFILE_MIN_TOTAL_SAMPLES || !profile.bins.length) {
    return null;
  }

  const usableCadence = Number.isFinite(cadence) ? cadence : NaN;
  const usableHeartrate = Number.isFinite(heartrate) ? heartrate : NaN;
  let chosenBin: AthleteCadenceProfileBin | null = null;

  if (Number.isFinite(usableCadence)) {
    for (const bin of profile.bins) {
      if (bin.sample_count < PROFILE_MIN_BIN_SAMPLES) {
        continue;
      }

      if (!chosenBin || Math.abs(bin.cadence - usableCadence) < Math.abs(chosenBin.cadence - usableCadence)) {
        chosenBin = bin;
      }
    }
  }

  const basePaceSeconds =
    chosenBin?.median_pace_seconds_per_km ?? profile.median_pace_seconds_per_km;
  if (!Number.isFinite(basePaceSeconds)) {
    return null;
  }

  let estimatedPaceSeconds = Number(basePaceSeconds);
  const referenceHeartRate = chosenBin?.median_heartrate ?? profile.median_heartrate;
  if (Number.isFinite(usableHeartrate) && Number.isFinite(referenceHeartRate)) {
    const heartRateDelta = usableHeartrate - Number(referenceHeartRate);
    const boundedAdjustment = Math.max(-0.12, Math.min(0.12, heartRateDelta / 80));
    estimatedPaceSeconds *= 1 - boundedAdjustment;
  }

  return Math.max(PROFILE_MIN_PACE_SECONDS, Math.min(PROFILE_MAX_PACE_SECONDS, estimatedPaceSeconds));
}

function rebuildStreamsFromAthleteProfile(
  workout: WorkoutSummaryLike,
  streams: ActivityStreams,
  profile: AthleteCadenceProfile
) {
  const size = Math.min(
    streams.distance.length,
    streams.time.length,
    streams.heartrate.length || streams.time.length,
    streams.cadence.length || streams.time.length,
    streams.altitude.length || streams.time.length,
    streams.velocity_smooth.length || streams.time.length
  );

  if (size < 3) {
    return null;
  }

  const correctedDistance: number[] = [];
  const correctedTime: number[] = [];
  const correctedHeartrate: number[] = [];
  const correctedCadence: number[] = [];
  const correctedAltitude: number[] = [];
  const correctedVelocity: number[] = [];
  const correctedLatLng: [number, number][] = [];

  let cumulativeDistance = 0;

  for (let index = 0; index < size; index += 1) {
    const currentTime = Math.max(0, toFiniteNumber(streams.time[index]));
    const previousTime = index > 0 ? Math.max(0, toFiniteNumber(streams.time[index - 1])) : 0;
    const dt = index > 0 ? Math.max(0, currentTime - previousTime) : 0;
    const cadenceValue = toFiniteNumber(streams.cadence[index], NaN);
    const heartRateValue = toFiniteNumber(streams.heartrate[index], NaN);
    const estimatedPaceSeconds = estimatePaceFromProfile(profile, cadenceValue, heartRateValue);
    const fallbackPaceSeconds =
      profile.median_pace_seconds_per_km ??
      (toFiniteNumber(workout.average_speed, 0) > 0
        ? SPLIT_DISTANCE_METERS / toFiniteNumber(workout.average_speed, 0)
        : 360);
    const selectedPaceSeconds = estimatedPaceSeconds ?? fallbackPaceSeconds;
    const estimatedSpeed = selectedPaceSeconds > 0 ? SPLIT_DISTANCE_METERS / selectedPaceSeconds : 0;

    if (index > 0 && dt > 0) {
      cumulativeDistance += estimatedSpeed * dt;
    }

    correctedDistance.push(cumulativeDistance);
    correctedTime.push(currentTime);
    correctedHeartrate.push(heartRateValue);
    correctedCadence.push(cadenceValue);
    correctedAltitude.push(toFiniteNumber(streams.altitude[index], NaN));
    correctedVelocity.push(estimatedSpeed > 0 ? estimatedSpeed : NaN);

    const latLngPoint = streams.latlng[index];
    if (Array.isArray(latLngPoint) && latLngPoint.length >= 2) {
      correctedLatLng.push([latLngPoint[0], latLngPoint[1]]);
    }
  }

  const normalizedLatLng = correctedLatLng.filter(
    (point): point is [number, number] =>
      Number.isFinite(point[0]) && Number.isFinite(point[1])
  );

  return {
    distance: correctedDistance,
    time: correctedTime,
    heartrate: correctedHeartrate,
    cadence: correctedCadence,
    altitude: correctedAltitude,
    velocity_smooth: correctedVelocity,
    latlng: normalizedLatLng
  } satisfies CorrectedStreamsPayload;
}

export async function buildAthleteCadenceProfile(userId: number, excludeWorkoutId: number) {
  const result = await pool.query<{
    distance_stream: number[] | null;
    time_stream: number[] | null;
    heartrate_stream: number[] | null;
    cadence_stream: number[] | null;
  }>(
    `
      select
        ws.distance_stream,
        ws.time_stream,
        ws.heartrate_stream,
        ws.cadence_stream
      from workouts w
      join workout_streams ws on ws.workout_id = w.id
      left join workout_corrections wc on wc.workout_id = w.id
      where w.user_id = $1
        and w.id <> $2
        and w.sport_type ilike '%run%'
        and wc.workout_id is null
        and w.distance_meters >= 2000
        and w.moving_time_seconds >= 600
        and coalesce(w.average_speed, 0) > 0
        and (1000 / nullif(w.average_speed, 0)) between $3 and $4
        and jsonb_array_length(ws.cadence_stream) > 0
      order by w.start_date desc
      limit 20
    `,
    [userId, excludeWorkoutId, PROFILE_MIN_PACE_SECONDS, PROFILE_MAX_PACE_SECONDS]
  );

  const paceBuckets = new Map<number, number[]>();
  const heartRateBuckets = new Map<number, number[]>();
  const allPaces: number[] = [];
  const allHeartRates: number[] = [];

  for (const row of result.rows) {
    const distance = Array.isArray(row.distance_stream) ? row.distance_stream : [];
    const time = Array.isArray(row.time_stream) ? row.time_stream : [];
    const heartrate = Array.isArray(row.heartrate_stream) ? row.heartrate_stream : [];
    const cadence = Array.isArray(row.cadence_stream) ? row.cadence_stream : [];
    const size = Math.min(distance.length, time.length, cadence.length || time.length, heartrate.length || time.length);

    for (let index = 1; index < size; index += 1) {
      const dt = toFiniteNumber(time[index]) - toFiniteNumber(time[index - 1]);
      const dd = toFiniteNumber(distance[index]) - toFiniteNumber(distance[index - 1]);
      const cadenceValue = toFiniteNumber(cadence[index], NaN);
      const heartRateValue = toFiniteNumber(heartrate[index], NaN);
      if (
        dt < PROFILE_MIN_SEGMENT_SECONDS ||
        dt > PROFILE_MAX_SEGMENT_SECONDS ||
        dd <= 0 ||
        dd > PROFILE_MAX_SEGMENT_DISTANCE_METERS ||
        !Number.isFinite(cadenceValue) ||
        cadenceValue < PROFILE_MIN_CADENCE ||
        cadenceValue > PROFILE_MAX_CADENCE
      ) {
        continue;
      }

      const paceSeconds = (dt / dd) * SPLIT_DISTANCE_METERS;
      if (
        !Number.isFinite(paceSeconds) ||
        paceSeconds < PROFILE_MIN_PACE_SECONDS ||
        paceSeconds > PROFILE_MAX_PACE_SECONDS
      ) {
        continue;
      }

      const cadenceBin = Math.round(cadenceValue / PROFILE_BIN_SIZE) * PROFILE_BIN_SIZE;
      const bucket = paceBuckets.get(cadenceBin) ?? [];
      bucket.push(paceSeconds);
      paceBuckets.set(cadenceBin, bucket);
      allPaces.push(paceSeconds);

      if (Number.isFinite(heartRateValue) && heartRateValue > 0) {
        const heartBucket = heartRateBuckets.get(cadenceBin) ?? [];
        heartBucket.push(heartRateValue);
        heartRateBuckets.set(cadenceBin, heartBucket);
        allHeartRates.push(heartRateValue);
      }
    }
  }

  if (allPaces.length < PROFILE_MIN_TOTAL_SAMPLES) {
    return null;
  }

  const bins = [...paceBuckets.entries()]
    .map(([cadenceBin, paceValues]) => ({
      cadence: cadenceBin,
      median_pace_seconds_per_km: median(paceValues) ?? 0,
      median_heartrate: median(heartRateBuckets.get(cadenceBin) ?? []),
      sample_count: paceValues.length
    }))
    .filter((bin) => bin.sample_count >= PROFILE_MIN_BIN_SAMPLES)
    .sort((left, right) => left.cadence - right.cadence);

  if (!bins.length) {
    return null;
  }

  return {
    bins,
    median_pace_seconds_per_km: median(allPaces),
    median_heartrate: median(allHeartRates),
    sample_count: allPaces.length
  } satisfies AthleteCadenceProfile;
}

function buildSegments(suspectSteps: number[], distance: number[], time: number[]) {
  if (!suspectSteps.length) {
    return [] as RemovedSegment[];
  }

  const segments: RemovedSegment[] = [];
  let rangeStart = suspectSteps[0];
  let rangeEnd = suspectSteps[0];
  let peakSpeedMetersPerSecond = 0;

  function pushSegment(startStep: number, endStep: number, peakSpeed: number) {
    const startIndex = Math.max(1, startStep - 1);
    const endIndex = Math.max(startIndex + 1, endStep + 1);
    const removedDistanceMeters = Math.max(
      0,
      toFiniteNumber(distance[endIndex]) - toFiniteNumber(distance[startIndex])
    );
    const removedTimeSeconds = Math.max(
      0,
      toFiniteNumber(time[endIndex]) - toFiniteNumber(time[startIndex])
    );

    if (removedDistanceMeters < MIN_REMOVAL_DISTANCE_METERS) {
      return;
    }

    segments.push({
      startIndex,
      endIndex,
      removedDistanceMeters,
      removedTimeSeconds,
      peakSpeedMetersPerSecond: peakSpeed
    });
  }

  for (let index = 0; index < suspectSteps.length; index += 1) {
    const step = suspectSteps[index];
    const nextStep = suspectSteps[index + 1];

    rangeEnd = step;
    const dt = Math.max(0, toFiniteNumber(time[step]) - toFiniteNumber(time[step - 1]));
    const dd = Math.max(0, toFiniteNumber(distance[step]) - toFiniteNumber(distance[step - 1]));
    if (dt > 0) {
      peakSpeedMetersPerSecond = Math.max(peakSpeedMetersPerSecond, dd / dt);
    }

    if (nextStep !== undefined && nextStep - step <= MAX_SUSPECT_GAP) {
      continue;
    }

    pushSegment(rangeStart, rangeEnd, peakSpeedMetersPerSecond);
    rangeStart = nextStep ?? 0;
    peakSpeedMetersPerSecond = 0;
  }

  return segments;
}

function createKeepMask(length: number, removedSegments: RemovedSegment[]) {
  const keepMask = Array.from({ length }, () => true);

  for (const segment of removedSegments) {
    for (let index = segment.startIndex; index <= segment.endIndex && index < keepMask.length; index += 1) {
      keepMask[index] = false;
    }
  }

  return keepMask;
}

function rebuildCorrectedStreams(streams: ActivityStreams, keepMask: boolean[]) {
  const correctedDistance: number[] = [];
  const correctedTime: number[] = [];
  const correctedHeartrate: number[] = [];
  const correctedAltitude: number[] = [];
  const correctedCadence: number[] = [];
  const correctedVelocity: number[] = [];
  const correctedLatLng: [number, number][] = [];
  const keptOriginalIndices: number[] = [];
  const originalToCorrectedIndex = new Map<number, number>();

  let cumulativeDistance = 0;
  let cumulativeTime = 0;
  let previousOriginalIndex: number | null = null;

  for (let index = 0; index < keepMask.length; index += 1) {
    if (!keepMask[index]) {
      continue;
    }

    if (previousOriginalIndex !== null && index === previousOriginalIndex + 1) {
      cumulativeDistance += Math.max(
        0,
        toFiniteNumber(streams.distance[index]) - toFiniteNumber(streams.distance[previousOriginalIndex])
      );
      cumulativeTime += Math.max(
        0,
        toFiniteNumber(streams.time[index]) - toFiniteNumber(streams.time[previousOriginalIndex])
      );
    }

    const correctedIndex = correctedDistance.length;
    keptOriginalIndices.push(index);
    originalToCorrectedIndex.set(index, correctedIndex);
    correctedDistance.push(cumulativeDistance);
    correctedTime.push(cumulativeTime);
    correctedHeartrate.push(toFiniteNumber(streams.heartrate[index], NaN));
    correctedCadence.push(toFiniteNumber(streams.cadence[index], NaN));
    correctedAltitude.push(toFiniteNumber(streams.altitude[index], NaN));
    correctedVelocity.push(toFiniteNumber(streams.velocity_smooth[index], NaN));

    const latLngPoint = streams.latlng[index];
    if (Array.isArray(latLngPoint) && latLngPoint.length >= 2) {
      correctedLatLng.push([latLngPoint[0], latLngPoint[1]]);
    } else {
      correctedLatLng.push([NaN, NaN]);
    }

    previousOriginalIndex = index;
  }

  const normalizedLatLng = correctedLatLng.filter(
    (point): point is [number, number] =>
      Number.isFinite(point[0]) && Number.isFinite(point[1])
  );

  return {
    keptOriginalIndices,
    originalToCorrectedIndex,
    streams: {
      distance: correctedDistance,
      time: correctedTime,
      heartrate: correctedHeartrate,
      cadence: correctedCadence,
      altitude: correctedAltitude,
      velocity_smooth: correctedVelocity,
      latlng: normalizedLatLng
    } satisfies CorrectedStreamsPayload
  };
}

function rebuildCorrectedLaps(
  laps: WorkoutLapRow[],
  correctedStreams: CorrectedStreamsPayload,
  originalToCorrectedIndex: Map<number, number>
) {
  const result: CorrectedLapPayload[] = [];

  for (const lap of laps) {
    if (lap.start_index === null || lap.end_index === null) {
      continue;
    }

    const correctedIndices: number[] = [];
    for (let index = lap.start_index; index <= lap.end_index; index += 1) {
      const correctedIndex = originalToCorrectedIndex.get(index);
      if (correctedIndex !== undefined) {
        correctedIndices.push(correctedIndex);
      }
    }

    if (correctedIndices.length < 2) {
      continue;
    }

    const firstIndex = correctedIndices[0];
    const lastIndex = correctedIndices[correctedIndices.length - 1];
    const distanceMeters =
      toFiniteNumber(correctedStreams.distance[lastIndex]) -
      toFiniteNumber(correctedStreams.distance[firstIndex]);
    const elapsedTimeSeconds =
      toFiniteNumber(correctedStreams.time[lastIndex]) -
      toFiniteNumber(correctedStreams.time[firstIndex]);

    if (distanceMeters <= 0 || elapsedTimeSeconds <= 0) {
      continue;
    }

    const lapHeartRateValues = correctedIndices
      .map((index) => correctedStreams.heartrate[index])
      .filter((value) => Number.isFinite(value) && value > 0);
    const lapAltitudeValues = correctedIndices
      .map((index) => correctedStreams.altitude[index])
      .filter((value) => Number.isFinite(value));

    result.push({
      id: lap.id,
      name: lap.name,
      distance_meters: distanceMeters,
      elapsed_time_seconds: Math.round(elapsedTimeSeconds),
      average_speed: elapsedTimeSeconds > 0 ? distanceMeters / elapsedTimeSeconds : null,
      average_heartrate: lapHeartRateValues.length
        ? lapHeartRateValues.reduce((sum, value) => sum + value, 0) / lapHeartRateValues.length
        : null,
      elevation_gain: lapAltitudeValues.length ? computePositiveElevationGain(lapAltitudeValues) : null
    });
  }

  return result;
}

export function buildGpsFixPreview(
  workout: WorkoutSummary,
  laps: WorkoutLapRow[],
  streams: ActivityStreams | null,
  athleteProfile: AthleteCadenceProfile | null = null
) {
  if (!streams?.distance?.length || !streams.time?.length) {
    return null;
  }

  const size = Math.min(
    streams.distance.length,
    streams.time.length,
    streams.velocity_smooth.length || streams.distance.length,
    streams.latlng.length || streams.distance.length
  );

  if (size < 6) {
    return null;
  }

  const suspectSteps: number[] = [];
  const hasUsableAthleteProfile =
    athleteProfile !== null &&
    athleteProfile.sample_count >= PROFILE_MIN_TOTAL_SAMPLES &&
    athleteProfile.bins.length > 0;
  const workoutAverageSpeed = toFiniteNumber(workout.average_speed, 0);
  const workoutAveragePaceSeconds =
    workoutAverageSpeed > 0 ? SPLIT_DISTANCE_METERS / workoutAverageSpeed : null;
  let profileComparableSamples = 0;
  let profileMismatchSamples = 0;
  const hrHighThreshold = (() => {
    const maxHr = toFiniteNumber(workout.max_heartrate, 0);
    if (maxHr > 0) {
      return maxHr * HIGH_INTENSITY_HR_FRACTION;
    }
    const averageHr = toFiniteNumber(workout.average_heartrate, 0);
    return averageHr > 0 ? averageHr + 12 : 0;
  })();

  for (let index = 1; index < size; index += 1) {
    const dt = toFiniteNumber(streams.time[index]) - toFiniteNumber(streams.time[index - 1]);
    if (dt <= 0) {
      continue;
    }

    const distanceDelta = Math.max(
      0,
      toFiniteNumber(streams.distance[index]) - toFiniteNumber(streams.distance[index - 1])
    );
    const recordedSpeed = distanceDelta / dt;

    let geoDistance = distanceDelta;
    if (
      Array.isArray(streams.latlng[index - 1]) &&
      Array.isArray(streams.latlng[index])
    ) {
      geoDistance = haversineMeters(streams.latlng[index - 1]!, streams.latlng[index]!);
    }

    const geoSpeed = geoDistance / dt;
    const distanceJump = distanceDelta > MAX_STEP_DISTANCE_METERS && dt < 12;
    const geoJump = geoDistance > MAX_STEP_GEO_DISTANCE_METERS && dt < 12;
    const cadenceValue = toFiniteNumber(streams.cadence[index], NaN);
    const heartRateValue = toFiniteNumber(streams.heartrate[index], NaN);
    const cadenceLooksNormal =
      Number.isFinite(cadenceValue) &&
      cadenceValue > 0 &&
      cadenceValue <= MAX_NORMAL_CADENCE;
    const cadenceLooksBroken =
      Number.isFinite(cadenceValue) &&
      cadenceValue > MAX_REALISTIC_CADENCE;
    const heartRateLooksModerate =
      Number.isFinite(heartRateValue) &&
      heartRateValue > 0 &&
      hrHighThreshold > 0 &&
      heartRateValue < hrHighThreshold;
    const heartRateLooksHigh =
      Number.isFinite(heartRateValue) &&
      heartRateValue > 0 &&
      hrHighThreshold > 0 &&
      heartRateValue >= hrHighThreshold;
    const expectedPaceSeconds = estimatePaceFromProfile(athleteProfile, cadenceValue, heartRateValue);
    const expectedSpeed = expectedPaceSeconds ? SPLIT_DISTANCE_METERS / expectedPaceSeconds : null;
    const profileMismatch =
      expectedSpeed !== null &&
      expectedSpeed > 0 &&
      (recordedSpeed > expectedSpeed * PROFILE_FAST_MISMATCH_FACTOR ||
        geoSpeed > expectedSpeed * PROFILE_FAST_MISMATCH_FACTOR);
    const strongProfileMismatch =
      expectedSpeed !== null &&
      expectedSpeed > 0 &&
      (recordedSpeed > expectedSpeed * PROFILE_STRONG_FAST_MISMATCH_FACTOR ||
        geoSpeed > expectedSpeed * PROFILE_STRONG_FAST_MISMATCH_FACTOR);

    if (expectedSpeed !== null && expectedSpeed > 0) {
      profileComparableSamples += 1;
      if (profileMismatch) {
        profileMismatchSamples += 1;
      }
    }

    const cadenceHrSupport =
      cadenceLooksBroken ||
      ((recordedSpeed > MAX_RUN_SPEED_MPS + 0.7 || geoSpeed > MAX_GEO_SPEED_MPS + 0.7) &&
        cadenceLooksNormal &&
        heartRateLooksModerate);
    const strongRawSignal =
      recordedSpeed > MAX_RUN_SPEED_MPS + 1.4 ||
      geoSpeed > MAX_GEO_SPEED_MPS + 1.4 ||
      distanceDelta > MAX_STEP_DISTANCE_METERS * 1.8 ||
      geoDistance > MAX_STEP_GEO_DISTANCE_METERS * 1.8;

    if (
      distanceJump ||
      geoJump ||
      strongRawSignal ||
      strongProfileMismatch ||
      (hasUsableAthleteProfile && profileMismatch) ||
      (
        (recordedSpeed > MAX_RUN_SPEED_MPS || geoSpeed > MAX_GEO_SPEED_MPS) &&
        (!heartRateLooksHigh && cadenceHrSupport || profileMismatch)
      )
    ) {
      suspectSteps.push(index);
    }
  }

  const shouldRebuildWholeWorkoutFromProfile =
    hasUsableAthleteProfile &&
    (
      (
        workoutAveragePaceSeconds !== null &&
        (
          workoutAveragePaceSeconds < PROFILE_ABSURD_PACE_OVERRIDE_SECONDS ||
          workoutAverageSpeed > PROFILE_ABSURD_SPEED_OVERRIDE_MPS
        )
      ) ||
      (
        profileComparableSamples >= PROFILE_MIN_COMPARABLE_SAMPLES &&
        profileMismatchSamples / profileComparableSamples >= PROFILE_PRIMARY_WHOLE_WORKOUT_RATIO
      ) ||
      (
        profileComparableSamples >= PROFILE_MIN_TOTAL_SAMPLES / 2 &&
        profileMismatchSamples / profileComparableSamples >= PROFILE_WHOLE_WORKOUT_MISMATCH_RATIO
      ) ||
      (
        workoutAveragePaceSeconds !== null &&
        Number.isFinite(athleteProfile!.median_pace_seconds_per_km) &&
        workoutAveragePaceSeconds <
          athleteProfile!.median_pace_seconds_per_km! * PROFILE_AVERAGE_PACE_OVERRIDE_FACTOR
      )
    );

  if (shouldRebuildWholeWorkoutFromProfile) {
    const correctedStreams = rebuildStreamsFromAthleteProfile(workout, streams, athleteProfile!);
    if (correctedStreams) {
      const correctedDistanceMeters = correctedStreams.distance[correctedStreams.distance.length - 1] ?? 0;
      const correctedMovingTimeSeconds = Math.round(
        correctedStreams.time[correctedStreams.time.length - 1] ?? 0
      );
      const validHeartRates = correctedStreams.heartrate.filter((value) => Number.isFinite(value) && value > 0);
      const { correctedLaps } = buildCorrectedSplits(
        workout,
        correctedStreams,
        correctedDistanceMeters,
        correctedMovingTimeSeconds
      );

      if (
        correctedDistanceMeters > 0 &&
        correctedMovingTimeSeconds > 0 &&
        correctedDistanceMeters < toFiniteNumber(workout.distance_meters)
      ) {
        return {
          removedSegments: [
            {
              startIndex: 1,
              endIndex: size - 1,
              removedDistanceMeters: Math.max(
                0,
                toFiniteNumber(workout.distance_meters) - correctedDistanceMeters
              ),
              removedTimeSeconds: 0,
              peakSpeedMetersPerSecond: toFiniteNumber(workout.average_speed)
            }
          ],
          correctedWorkout: {
            distance_meters: correctedDistanceMeters,
            moving_time_seconds: correctedMovingTimeSeconds,
            elapsed_time_seconds: correctedMovingTimeSeconds,
            elevation_gain: correctedStreams.altitude.length
              ? computePositiveElevationGain(correctedStreams.altitude)
              : workout.elevation_gain,
            average_speed:
              correctedMovingTimeSeconds > 0
                ? correctedDistanceMeters / correctedMovingTimeSeconds
                : null,
            average_heartrate: computeAverageHeartRate(correctedStreams.heartrate),
            max_heartrate: validHeartRates.length ? Math.max(...validHeartRates) : null
          },
          correctedStreams,
          correctedLaps
        } satisfies GpsFixPreview;
      }
    }
  }

  const removedSegments = buildSegments(suspectSteps, streams.distance, streams.time);
  if (!removedSegments.length) {
    return null;
  }

  const keepMask = createKeepMask(size, removedSegments);
  const keptPoints = keepMask.filter(Boolean).length;
  if (keptPoints < 3) {
    return null;
  }

  const rebuilt = rebuildCorrectedStreams(streams, keepMask);
  const correctedStreams = rebuilt.streams;
  const correctedDistanceMeters = correctedStreams.distance[correctedStreams.distance.length - 1] ?? 0;
  const correctedMovingTimeSeconds = Math.round(
    correctedStreams.time[correctedStreams.time.length - 1] ?? 0
  );

  if (
    correctedDistanceMeters <= 0 ||
    correctedMovingTimeSeconds <= 0 ||
    correctedDistanceMeters >= workout.distance_meters
  ) {
    return null;
  }

  const correctedAverageHeartRate = computeAverageHeartRate(correctedStreams.heartrate);
  const validHeartRates = correctedStreams.heartrate.filter((value) => Number.isFinite(value) && value > 0);
  const correctedLaps = rebuildCorrectedLaps(laps, correctedStreams, rebuilt.originalToCorrectedIndex);

  return {
    removedSegments,
    correctedWorkout: {
      distance_meters: correctedDistanceMeters,
      moving_time_seconds: correctedMovingTimeSeconds,
      elapsed_time_seconds: correctedMovingTimeSeconds,
      elevation_gain: correctedStreams.altitude.length
        ? computePositiveElevationGain(correctedStreams.altitude)
        : workout.elevation_gain,
      average_speed:
        correctedMovingTimeSeconds > 0
          ? correctedDistanceMeters / correctedMovingTimeSeconds
          : null,
      average_heartrate: correctedAverageHeartRate,
      max_heartrate: validHeartRates.length ? Math.max(...validHeartRates) : null
    },
    correctedStreams,
    correctedLaps
  } satisfies GpsFixPreview;
}

export function buildManualDistancePreview(
  workout: WorkoutSummaryLike,
  streams: ActivityStreams | CorrectedStreamsPayload | null,
  targetDistanceMeters: number
) {
  if (!streams?.distance?.length || !streams.time?.length) {
    return null;
  }

  const currentDistanceMeters = toFiniteNumber(streams.distance[streams.distance.length - 1]);
  const movingTimeSeconds = Math.round(toFiniteNumber(streams.time[streams.time.length - 1]));
  if (
    currentDistanceMeters <= 0 ||
    movingTimeSeconds <= 0 ||
    targetDistanceMeters < MIN_MANUAL_DISTANCE_METERS ||
    targetDistanceMeters > MAX_MANUAL_DISTANCE_METERS
  ) {
    return null;
  }

  const scaleFactor = targetDistanceMeters / currentDistanceMeters;
  if (!Number.isFinite(scaleFactor) || Math.abs(scaleFactor - 1) < 0.005) {
    return null;
  }

  const correctedStreams = {
    distance: streams.distance.map((value) => Math.max(0, toFiniteNumber(value) * scaleFactor)),
    time: streams.time.map((value) => Math.max(0, toFiniteNumber(value))),
    heartrate: streams.heartrate.map((value) => toFiniteNumber(value, NaN)),
    cadence: streams.cadence.map((value) => toFiniteNumber(value, NaN)),
    altitude: streams.altitude.map((value) => toFiniteNumber(value, NaN)),
    velocity_smooth: streams.velocity_smooth.map((value) =>
      Number.isFinite(value) ? toFiniteNumber(value) * scaleFactor : NaN
    ),
    latlng: streams.latlng.filter(
      (point): point is [number, number] =>
        Array.isArray(point) &&
        point.length >= 2 &&
        Number.isFinite(point[0]) &&
        Number.isFinite(point[1])
    )
  } satisfies CorrectedStreamsPayload;

  const validHeartRates = correctedStreams.heartrate.filter((value) => Number.isFinite(value) && value > 0);
  const { splitStrategy, correctedLaps } = buildCorrectedSplits(
    workout,
    correctedStreams,
    targetDistanceMeters,
    movingTimeSeconds
  );

  return {
    correctedWorkout: {
      distance_meters: targetDistanceMeters,
      moving_time_seconds: movingTimeSeconds,
      elapsed_time_seconds: Math.round(
        toFiniteNumber(workout.elapsed_time_seconds, movingTimeSeconds)
      ),
      elevation_gain: toFiniteNumber(workout.elevation_gain),
      average_speed: movingTimeSeconds > 0 ? targetDistanceMeters / movingTimeSeconds : null,
      average_heartrate: computeAverageHeartRate(correctedStreams.heartrate),
      max_heartrate: validHeartRates.length ? Math.max(...validHeartRates) : workout.max_heartrate
    },
    correctedStreams,
    correctedLaps,
    metadata: {
      target_distance_meters: targetDistanceMeters,
      source_distance_meters: currentDistanceMeters,
      scale_factor: scaleFactor,
      split_strategy: splitStrategy
    }
  } satisfies ManualDistancePreview;
}

export function buildManualTimePreview(
  workout: WorkoutSummaryLike,
  streams: ActivityStreams | CorrectedStreamsPayload | null,
  targetMovingTimeSeconds: number
) {
  if (!streams?.distance?.length || !streams.time?.length) {
    return null;
  }

  const currentDistanceMeters = toFiniteNumber(streams.distance[streams.distance.length - 1]);
  const currentMovingTimeSeconds = Math.round(toFiniteNumber(streams.time[streams.time.length - 1]));
  if (
    currentDistanceMeters <= 0 ||
    currentMovingTimeSeconds <= 0 ||
    targetMovingTimeSeconds < MIN_MANUAL_TIME_SECONDS ||
    targetMovingTimeSeconds > MAX_MANUAL_TIME_SECONDS
  ) {
    return null;
  }

  const scaleFactor = targetMovingTimeSeconds / currentMovingTimeSeconds;
  if (!Number.isFinite(scaleFactor) || Math.abs(scaleFactor - 1) < 0.005) {
    return null;
  }

  const correctedStreams = {
    distance: streams.distance.map((value) => Math.max(0, toFiniteNumber(value))),
    time: streams.time.map((value) => Math.max(0, toFiniteNumber(value) * scaleFactor)),
    heartrate: streams.heartrate.map((value) => toFiniteNumber(value, NaN)),
    cadence: streams.cadence.map((value) => toFiniteNumber(value, NaN)),
    altitude: streams.altitude.map((value) => toFiniteNumber(value, NaN)),
    velocity_smooth: streams.velocity_smooth.map((value) =>
      Number.isFinite(value) && scaleFactor > 0 ? toFiniteNumber(value) / scaleFactor : NaN
    ),
    latlng: streams.latlng.filter(
      (point): point is [number, number] =>
        Array.isArray(point) &&
        point.length >= 2 &&
        Number.isFinite(point[0]) &&
        Number.isFinite(point[1])
    )
  } satisfies CorrectedStreamsPayload;

  const validHeartRates = correctedStreams.heartrate.filter((value) => Number.isFinite(value) && value > 0);
  const { splitStrategy, correctedLaps } = buildCorrectedSplits(
    workout,
    correctedStreams,
    currentDistanceMeters,
    targetMovingTimeSeconds
  );

  return {
    correctedWorkout: {
      distance_meters: currentDistanceMeters,
      moving_time_seconds: targetMovingTimeSeconds,
      elapsed_time_seconds: Math.round(
        toFiniteNumber(workout.elapsed_time_seconds, currentMovingTimeSeconds) * scaleFactor
      ),
      elevation_gain: toFiniteNumber(workout.elevation_gain),
      average_speed: targetMovingTimeSeconds > 0 ? currentDistanceMeters / targetMovingTimeSeconds : null,
      average_heartrate: computeAverageHeartRate(correctedStreams.heartrate),
      max_heartrate: validHeartRates.length ? Math.max(...validHeartRates) : workout.max_heartrate
    },
    correctedStreams,
    correctedLaps,
    metadata: {
      target_moving_time_seconds: targetMovingTimeSeconds,
      source_moving_time_seconds: currentMovingTimeSeconds,
      scale_factor: scaleFactor,
      split_strategy: splitStrategy
    }
  } satisfies ManualTimePreview;
}

export async function getActiveWorkoutCorrection(workoutId: number) {
  const result = await pool.query<StoredCorrectionRow>(
    `
      select
        workout_id,
        kind,
        corrected_distance_meters,
        corrected_moving_time_seconds,
        corrected_elapsed_time_seconds,
        corrected_elevation_gain,
        corrected_average_speed,
        corrected_average_heartrate,
        corrected_max_heartrate,
        removed_segments,
        corrected_streams,
        corrected_laps,
        created_by_user_id,
        created_at,
        updated_at
      from workout_corrections
      where workout_id = $1
    `,
    [workoutId]
  );

  return result.rows[0] ?? null;
}

export function applyWorkoutCorrectionToView(
  workout: Record<string, unknown>,
  laps: WorkoutLapRow[],
  streams: ActivityStreams | null,
  correction: StoredCorrectionRow | null
) {
  if (!correction) {
    return {
      workout: {
        ...workout,
        gps_fix: null
      },
      laps,
      streams
    };
  }

  const correctedStreams = correction.corrected_streams ?? streams;
  const correctedLaps = Array.isArray(correction.corrected_laps) ? correction.corrected_laps : laps;

  return {
    workout: {
      ...workout,
      distance_meters: correction.corrected_distance_meters,
      moving_time_seconds: correction.corrected_moving_time_seconds,
      elapsed_time_seconds: correction.corrected_elapsed_time_seconds,
      elevation_gain: correction.corrected_elevation_gain,
      average_speed: correction.corrected_average_speed,
      average_heartrate: correction.corrected_average_heartrate,
      max_heartrate: correction.corrected_max_heartrate,
      gps_fix: {
        is_corrected: true,
        kind: correction.kind,
        removed_segments: Array.isArray(correction.removed_segments) ? correction.removed_segments : [],
        created_by_user_id: correction.created_by_user_id,
        created_at: correction.created_at,
        updated_at: correction.updated_at
      }
    },
    laps: correctedLaps,
    streams: correctedStreams
  };
}

export async function upsertWorkoutCorrection(
  workoutId: number,
  createdByUserId: number,
  kind: WorkoutCorrectionKind,
  preview: WorkoutCorrectionPreview
) {
  await pool.query(
    `
      insert into workout_corrections (
        workout_id,
        kind,
        corrected_distance_meters,
        corrected_moving_time_seconds,
        corrected_elapsed_time_seconds,
        corrected_elevation_gain,
        corrected_average_speed,
        corrected_average_heartrate,
        corrected_max_heartrate,
        removed_segments,
        corrected_streams,
        corrected_laps,
        created_by_user_id,
        updated_at
      )
      values (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10::jsonb, $11::jsonb, $12::jsonb, $13, now()
      )
      on conflict (workout_id) do update
      set kind = excluded.kind,
          corrected_distance_meters = excluded.corrected_distance_meters,
          corrected_moving_time_seconds = excluded.corrected_moving_time_seconds,
          corrected_elapsed_time_seconds = excluded.corrected_elapsed_time_seconds,
          corrected_elevation_gain = excluded.corrected_elevation_gain,
          corrected_average_speed = excluded.corrected_average_speed,
          corrected_average_heartrate = excluded.corrected_average_heartrate,
          corrected_max_heartrate = excluded.corrected_max_heartrate,
          removed_segments = excluded.removed_segments,
          corrected_streams = excluded.corrected_streams,
          corrected_laps = excluded.corrected_laps,
          created_by_user_id = excluded.created_by_user_id,
          updated_at = now()
    `,
    [
      workoutId,
      kind,
      preview.correctedWorkout.distance_meters,
      preview.correctedWorkout.moving_time_seconds,
      preview.correctedWorkout.elapsed_time_seconds,
      preview.correctedWorkout.elevation_gain,
      preview.correctedWorkout.average_speed,
      preview.correctedWorkout.average_heartrate,
      preview.correctedWorkout.max_heartrate,
      JSON.stringify("removedSegments" in preview ? preview.removedSegments : preview.metadata),
      JSON.stringify(preview.correctedStreams),
      JSON.stringify(preview.correctedLaps),
      createdByUserId
    ]
  );
}

export async function deleteWorkoutCorrection(workoutId: number) {
  await pool.query(`delete from workout_corrections where workout_id = $1`, [workoutId]);
}
