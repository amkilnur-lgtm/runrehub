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
  median_stride_length_meters: number;
  median_heartrate: number | null;
  sample_count: number;
};

export type AthleteCadenceProfile = {
  bins: AthleteCadenceProfileBin[];
  median_pace_seconds_per_km: number | null;
  median_stride_length_meters: number | null;
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
  metadata: {
    mode: "segment_cleanup" | "full_rebuild";
    confidence: "medium" | "high";
    reason:
      | "catastrophic_gps_failure"
      | "profile_mismatch"
      | "segment_spikes";
  };
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
const PROFILE_MAX_SEGMENT_SECONDS = 20;
const PROFILE_MAX_SEGMENT_DISTANCE_METERS = 120;
const PROFILE_MIN_PACE_SECONDS = 160;
const PROFILE_MAX_PACE_SECONDS = 900;
const PROFILE_BIN_SIZE = 5;
const PROFILE_MIN_TOTAL_SAMPLES = 5;
const PROFILE_MIN_BIN_SAMPLES = 1;
const PROFILE_FAST_MISMATCH_FACTOR = 1.85;
const PROFILE_STRONG_FAST_MISMATCH_FACTOR = 2.3;
const PROFILE_WHOLE_WORKOUT_MISMATCH_RATIO = 0.42;
const PROFILE_MIN_COMPARABLE_SAMPLES = 4;
const PROFILE_PRIMARY_WHOLE_WORKOUT_RATIO = 0.25;
const PROFILE_AVERAGE_PACE_OVERRIDE_FACTOR = 0.72;
const PROFILE_ABSURD_PACE_OVERRIDE_SECONDS = 120;
const PROFILE_ABSURD_SPEED_OVERRIDE_MPS = 10;
const HALF_CADENCE_MIN = 55;
const HALF_CADENCE_MAX = 110;
const MAX_GPS_DISTANCE_DISAGREEMENT_RATIO = 0.55;
const MIN_GPS_DISTANCE_DISAGREEMENT_METERS = 35;
const CATASTROPHIC_FAILURE_SCORE = 0.58;
const CATASTROPHIC_LONGEST_RUN_RATIO = 0.1;
const PROFILE_REBUILD_SMOOTHING_ALPHA = 0.35;
const PROFILE_STRIDE_BLEND_WEIGHT = 0.65;
const PROFILE_WORKOUT_INTENSITY_BOOST_CAP = 0.08;
const PROFILE_WORKOUT_INTENSITY_BOOST_THRESHOLD = 6;

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

function normalizeCadenceValue(value: number | null | undefined) {
  const cadence = toFiniteNumber(value, NaN);
  if (!Number.isFinite(cadence) || cadence <= 0) {
    return NaN;
  }

  if (cadence >= PROFILE_MIN_CADENCE && cadence <= PROFILE_MAX_CADENCE) {
    return cadence;
  }

  if (cadence >= HALF_CADENCE_MIN && cadence <= HALF_CADENCE_MAX) {
    const doubled = cadence * 2;
    if (doubled >= PROFILE_MIN_CADENCE && doubled <= PROFILE_MAX_CADENCE) {
      return doubled;
    }
  }

  return cadence;
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

function rollingMedian(values: number[], radius: number) {
  if (radius <= 0 || values.length <= 2) {
    return [...values];
  }

  return values.map((value, index) => {
    if (!Number.isFinite(value)) {
      return value;
    }

    const windowValues: number[] = [];
    const start = Math.max(0, index - radius);
    const end = Math.min(values.length - 1, index + radius);

    for (let cursor = start; cursor <= end; cursor += 1) {
      const candidate = values[cursor];
      if (Number.isFinite(candidate)) {
        windowValues.push(candidate);
      }
    }

    return median(windowValues) ?? value;
  });
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

    splits.push({
      id: lapIndex,
      name: null,
      distance_meters: distanceMeters,
      elapsed_time_seconds: Math.round(elapsedTimeSeconds),
      average_speed: distanceMeters / elapsedTimeSeconds,
      average_heartrate: heartRates.length
        ? heartRates.reduce((sum, value) => sum + value, 0) / heartRates.length
        : null,
      elevation_gain: 0
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
      elevation_gain: 0
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

function cadenceToStepsPerSecond(cadence: number) {
  return cadence > 0 ? cadence / 120 : 0;
}

function medianOfPrefix(values: number[], count: number) {
  const prefix = values.filter((value) => Number.isFinite(value) && value > 0).slice(0, count);
  return median(prefix);
}

function estimatePaceFromProfile(
  profile: AthleteCadenceProfile | null,
  cadence: number,
  heartrate: number
) {
  if (!profile || profile.sample_count < PROFILE_MIN_TOTAL_SAMPLES || !profile.bins.length) {
    return null;
  }

  const usableCadence = normalizeCadenceValue(cadence);
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

function estimateSpeedFromProfile(
  profile: AthleteCadenceProfile | null,
  cadence: number,
  heartrate: number
) {
  if (!profile || profile.sample_count < PROFILE_MIN_TOTAL_SAMPLES || !profile.bins.length) {
    return null;
  }

  const usableCadence = normalizeCadenceValue(cadence);
  if (!Number.isFinite(usableCadence) || usableCadence <= 0) {
    return null;
  }

  let chosenBin: AthleteCadenceProfileBin | null = null;
  for (const bin of profile.bins) {
    if (bin.sample_count < PROFILE_MIN_BIN_SAMPLES) {
      continue;
    }

    if (!chosenBin || Math.abs(bin.cadence - usableCadence) < Math.abs(chosenBin.cadence - usableCadence)) {
      chosenBin = bin;
    }
  }

  const strideLength =
    chosenBin?.median_stride_length_meters ?? profile.median_stride_length_meters;
  const paceSeconds = estimatePaceFromProfile(profile, usableCadence, heartrate);
  const paceSpeed = paceSeconds && paceSeconds > 0 ? SPLIT_DISTANCE_METERS / paceSeconds : null;

  let strideSpeed =
    Number.isFinite(strideLength) && Number(strideLength) > 0
      ? cadenceToStepsPerSecond(usableCadence) * Number(strideLength)
      : null;

  const referenceHeartRate = chosenBin?.median_heartrate ?? profile.median_heartrate;
  if (
    strideSpeed !== null &&
    Number.isFinite(heartrate) &&
    Number.isFinite(referenceHeartRate)
  ) {
    const heartRateDelta = heartrate - Number(referenceHeartRate);
    const boundedAdjustment = Math.max(-0.08, Math.min(0.08, heartRateDelta / 120));
    strideSpeed *= 1 + boundedAdjustment;
  }

  if (strideSpeed !== null && paceSpeed !== null) {
    return (
      strideSpeed * PROFILE_STRIDE_BLEND_WEIGHT +
      paceSpeed * (1 - PROFILE_STRIDE_BLEND_WEIGHT)
    );
  }

  return strideSpeed ?? paceSpeed;
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
  const smoothedCadence = rollingMedian(
    streams.cadence.map((value) => normalizeCadenceValue(toFiniteNumber(value, NaN))),
    2
  );
  const smoothedHeartrate = rollingMedian(
    streams.heartrate.map((value) => toFiniteNumber(value, NaN)),
    2
  );
  const cadenceBaseline = medianOfPrefix(smoothedCadence, 24);
  const heartRateBaseline = medianOfPrefix(smoothedHeartrate, 24);

  let cumulativeDistance = 0;
  let previousEstimatedSpeed: number | null = null;

  for (let index = 0; index < size; index += 1) {
    const currentTime = Math.max(0, toFiniteNumber(streams.time[index]));
    const previousTime = index > 0 ? Math.max(0, toFiniteNumber(streams.time[index - 1])) : 0;
    const dt = index > 0 ? Math.max(0, currentTime - previousTime) : 0;
    const normalizedCadence = smoothedCadence[index] ?? NaN;
    const heartRateValue = smoothedHeartrate[index] ?? NaN;
    const estimatedSpeedFromProfile = estimateSpeedFromProfile(
      profile,
      normalizedCadence,
      heartRateValue
    );
    const fallbackSpeed =
      toFiniteNumber(workout.average_speed, 0) > 0
        ? toFiniteNumber(workout.average_speed, 0)
        : profile.median_pace_seconds_per_km && profile.median_pace_seconds_per_km > 0
          ? SPLIT_DISTANCE_METERS / profile.median_pace_seconds_per_km
          : 1000 / 360;
    let rawEstimatedSpeed = estimatedSpeedFromProfile ?? fallbackSpeed;

    if (
      Number.isFinite(heartRateBaseline) &&
      Number.isFinite(heartRateValue) &&
      Number.isFinite(cadenceBaseline) &&
      Number.isFinite(normalizedCadence) &&
      normalizedCadence > 0
    ) {
      const heartRateDelta = heartRateValue - Number(heartRateBaseline);
      const cadenceSupport = Math.max(0.35, Math.min(1.05, normalizedCadence / Number(cadenceBaseline)));
      const workoutIntensityBoost = Math.max(
        0,
        Math.min(
          PROFILE_WORKOUT_INTENSITY_BOOST_CAP,
          ((heartRateDelta - PROFILE_WORKOUT_INTENSITY_BOOST_THRESHOLD) / 28) * cadenceSupport
        )
      );
      rawEstimatedSpeed *= 1 + workoutIntensityBoost;
    }

    const estimatedSpeed: number =
      previousEstimatedSpeed === null
        ? rawEstimatedSpeed
        : previousEstimatedSpeed +
          (rawEstimatedSpeed - previousEstimatedSpeed) * PROFILE_REBUILD_SMOOTHING_ALPHA;

    if (index > 0 && dt > 0) {
      cumulativeDistance += estimatedSpeed * dt;
    }

    correctedDistance.push(cumulativeDistance);
    correctedTime.push(currentTime);
    correctedHeartrate.push(heartRateValue);
    correctedCadence.push(normalizedCadence);
    correctedAltitude.push(toFiniteNumber(streams.altitude[index], NaN));
    correctedVelocity.push(estimatedSpeed > 0 ? estimatedSpeed : NaN);

    const latLngPoint = streams.latlng[index];
    if (Array.isArray(latLngPoint) && latLngPoint.length >= 2) {
      correctedLatLng.push([latLngPoint[0], latLngPoint[1]]);
    }

    previousEstimatedSpeed = estimatedSpeed > 0 ? estimatedSpeed : previousEstimatedSpeed;
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

function collectProfileSamplesFromStreams(input: {
  distance: number[];
  time: number[];
  cadence: number[];
  heartrate: number[];
}) {
  const normalizedCadence = input.cadence.map((value) =>
    normalizeCadenceValue(toFiniteNumber(value, NaN))
  );
  const smoothedCadence = rollingMedian(normalizedCadence, 2);
  const smoothedHeartrate = rollingMedian(
    input.heartrate.map((value) => toFiniteNumber(value, NaN)),
    2
  );
  const paceSamples: Array<{
    cadenceBin: number;
    paceSeconds: number;
    strideLengthMeters: number;
    heartRate: number | null;
  }> = [];

  let segmentStart = 0;
  for (let index = 1; index < Math.min(input.distance.length, input.time.length, smoothedCadence.length); index += 1) {
    const elapsedSeconds =
      toFiniteNumber(input.time[index]) - toFiniteNumber(input.time[segmentStart]);
    const segmentDistance =
      toFiniteNumber(input.distance[index]) - toFiniteNumber(input.distance[segmentStart]);
    const reachedWindow =
      elapsedSeconds >= PROFILE_MAX_SEGMENT_SECONDS ||
      segmentDistance >= PROFILE_MAX_SEGMENT_DISTANCE_METERS;

    if (!reachedWindow) {
      continue;
    }

    if (
      elapsedSeconds <= 0 ||
      segmentDistance <= 0 ||
      elapsedSeconds > PROFILE_MAX_SEGMENT_SECONDS * 1.6 ||
      segmentDistance > PROFILE_MAX_SEGMENT_DISTANCE_METERS * 1.6
    ) {
      segmentStart = index;
      continue;
    }

    const paceSeconds = (elapsedSeconds / segmentDistance) * SPLIT_DISTANCE_METERS;
    if (
      !Number.isFinite(paceSeconds) ||
      paceSeconds < PROFILE_MIN_PACE_SECONDS ||
      paceSeconds > PROFILE_MAX_PACE_SECONDS
    ) {
      segmentStart = index;
      continue;
    }

    const cadenceWindow = smoothedCadence
      .slice(segmentStart, index + 1)
      .filter(
        (value): value is number =>
          Number.isFinite(value) &&
          value >= PROFILE_MIN_CADENCE &&
          value <= PROFILE_MAX_CADENCE
      );
    if (!cadenceWindow.length) {
      segmentStart = index;
      continue;
    }

    const averageCadence =
      cadenceWindow.reduce((sum, value) => sum + value, 0) / cadenceWindow.length;
    const stepsPerSecond = cadenceToStepsPerSecond(averageCadence);
    if (!Number.isFinite(stepsPerSecond) || stepsPerSecond <= 0) {
      segmentStart = index;
      continue;
    }

    const strideLengthMeters = segmentDistance / (stepsPerSecond * elapsedSeconds);
    if (!Number.isFinite(strideLengthMeters) || strideLengthMeters <= 0.4 || strideLengthMeters > 2.2) {
      segmentStart = index;
      continue;
    }

    const cadenceBin = Math.round(averageCadence / PROFILE_BIN_SIZE) * PROFILE_BIN_SIZE;

    const heartRateWindow = smoothedHeartrate
      .slice(segmentStart, index + 1)
      .filter((value): value is number => Number.isFinite(value) && value > 0);
    const averageHeartRate = heartRateWindow.length
      ? heartRateWindow.reduce((sum, value) => sum + value, 0) / heartRateWindow.length
      : null;

    paceSamples.push({
      cadenceBin,
      paceSeconds,
      strideLengthMeters,
      heartRate: averageHeartRate
    });
    segmentStart = index;
  }

  return paceSamples;
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
      limit 12
    `,
    [userId, excludeWorkoutId, PROFILE_MIN_PACE_SECONDS, PROFILE_MAX_PACE_SECONDS]
  );

  const paceBuckets = new Map<number, number[]>();
  const strideBuckets = new Map<number, number[]>();
  const heartRateBuckets = new Map<number, number[]>();
  const allPaces: number[] = [];
  const allStrideLengths: number[] = [];
  const allHeartRates: number[] = [];

  for (const row of result.rows) {
    const distance = Array.isArray(row.distance_stream) ? row.distance_stream : [];
    const time = Array.isArray(row.time_stream) ? row.time_stream : [];
    const heartrate = Array.isArray(row.heartrate_stream) ? row.heartrate_stream : [];
    const cadence = Array.isArray(row.cadence_stream) ? row.cadence_stream : [];
    const samples = collectProfileSamplesFromStreams({
      distance,
      time,
      cadence,
      heartrate
    });

    for (const sample of samples) {
      const bucket = paceBuckets.get(sample.cadenceBin) ?? [];
      bucket.push(sample.paceSeconds);
      paceBuckets.set(sample.cadenceBin, bucket);
      allPaces.push(sample.paceSeconds);

      const strideBucket = strideBuckets.get(sample.cadenceBin) ?? [];
      strideBucket.push(sample.strideLengthMeters);
      strideBuckets.set(sample.cadenceBin, strideBucket);
      allStrideLengths.push(sample.strideLengthMeters);

      if (sample.heartRate !== null && Number.isFinite(sample.heartRate) && sample.heartRate > 0) {
        const heartBucket = heartRateBuckets.get(sample.cadenceBin) ?? [];
        heartBucket.push(sample.heartRate);
        heartRateBuckets.set(sample.cadenceBin, heartBucket);
        allHeartRates.push(sample.heartRate);
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
      median_stride_length_meters: median(strideBuckets.get(cadenceBin) ?? []) ?? 0,
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
    median_stride_length_meters: median(allStrideLengths),
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

function getLongestConsecutiveSuspectRun(suspectSteps: number[]) {
  if (!suspectSteps.length) {
    return 0;
  }

  let longest = 1;
  let current = 1;

  for (let index = 1; index < suspectSteps.length; index += 1) {
    if (suspectSteps[index]! - suspectSteps[index - 1]! <= MAX_SUSPECT_GAP + 1) {
      current += 1;
      longest = Math.max(longest, current);
      continue;
    }

    current = 1;
  }

  return longest;
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
      elevation_gain: 0
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
  let gpsDisagreementSamples = 0;
  let rawAnomalySamples = 0;
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
    const gpsDistanceDisagreement =
      Math.abs(distanceDelta - geoDistance) /
      Math.max(distanceDelta, geoDistance, 1);
    const distanceJump = distanceDelta > MAX_STEP_DISTANCE_METERS && dt < 12;
    const geoJump = geoDistance > MAX_STEP_GEO_DISTANCE_METERS && dt < 12;
    const cadenceValue = toFiniteNumber(streams.cadence[index], NaN);
    const normalizedCadence = normalizeCadenceValue(cadenceValue);
    const heartRateValue = toFiniteNumber(streams.heartrate[index], NaN);
    const cadenceLooksNormal =
      Number.isFinite(normalizedCadence) &&
      normalizedCadence > 0 &&
      normalizedCadence <= MAX_NORMAL_CADENCE;
    const cadenceLooksBroken =
      Number.isFinite(normalizedCadence) &&
      normalizedCadence > MAX_REALISTIC_CADENCE;
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
    const expectedPaceSeconds = estimatePaceFromProfile(
      athleteProfile,
      normalizedCadence,
      heartRateValue
    );
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
    const gpsSourcesConflict =
      Math.abs(distanceDelta - geoDistance) > MIN_GPS_DISTANCE_DISAGREEMENT_METERS &&
      gpsDistanceDisagreement >= MAX_GPS_DISTANCE_DISAGREEMENT_RATIO;

    if (gpsSourcesConflict) {
      gpsDisagreementSamples += 1;
    }

    if (distanceJump || geoJump || strongRawSignal) {
      rawAnomalySamples += 1;
    }

    if (
      distanceJump ||
      geoJump ||
      gpsSourcesConflict ||
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

  const suspectRatio = suspectSteps.length / Math.max(size - 1, 1);
  const rawAnomalyRatio = rawAnomalySamples / Math.max(size - 1, 1);
  const gpsDisagreementRatio = gpsDisagreementSamples / Math.max(size - 1, 1);
  const profileMismatchRatio =
    profileComparableSamples > 0 ? profileMismatchSamples / profileComparableSamples : 0;
  const longestSuspectRunRatio =
    getLongestConsecutiveSuspectRun(suspectSteps) / Math.max(size - 1, 1);
  const catastrophicFailureScore =
    rawAnomalyRatio * 0.38 +
    gpsDisagreementRatio * 0.24 +
    suspectRatio * 0.2 +
    profileMismatchRatio * 0.18;
  const hasCatastrophicGpsFailure =
    rawAnomalyRatio >= 0.16 ||
    gpsDisagreementRatio >= 0.18 ||
    longestSuspectRunRatio >= CATASTROPHIC_LONGEST_RUN_RATIO ||
    catastrophicFailureScore >= CATASTROPHIC_FAILURE_SCORE;

  const shouldRebuildWholeWorkoutFromProfile =
    hasUsableAthleteProfile &&
    (
      hasCatastrophicGpsFailure ||
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
          metadata: {
            mode: "full_rebuild",
            confidence: hasCatastrophicGpsFailure ? "high" : "medium",
            reason: hasCatastrophicGpsFailure ? "catastrophic_gps_failure" : "profile_mismatch"
          },
          correctedWorkout: {
            distance_meters: correctedDistanceMeters,
            moving_time_seconds: correctedMovingTimeSeconds,
            elapsed_time_seconds: correctedMovingTimeSeconds,
            elevation_gain: 0,
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
    metadata: {
      mode: "segment_cleanup",
      confidence: removedSegments.length >= 2 || suspectRatio >= 0.08 ? "high" : "medium",
      reason: "segment_spikes"
    },
    correctedWorkout: {
      distance_meters: correctedDistanceMeters,
      moving_time_seconds: correctedMovingTimeSeconds,
      elapsed_time_seconds: correctedMovingTimeSeconds,
      elevation_gain: correctedStreams.altitude.length
        ? 0
        : 0,
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
      elevation_gain: 0,
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
      elevation_gain: 0,
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
