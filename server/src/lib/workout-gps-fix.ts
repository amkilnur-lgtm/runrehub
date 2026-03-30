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
};

type ManualTimeMetadata = {
  target_moving_time_seconds: number;
  source_moving_time_seconds: number;
  scale_factor: number;
};

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
  streams: ActivityStreams | null
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
      (
        (recordedSpeed > MAX_RUN_SPEED_MPS || geoSpeed > MAX_GEO_SPEED_MPS) &&
        !heartRateLooksHigh &&
        cadenceHrSupport
      )
    ) {
      suspectSteps.push(index);
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
    correctedLaps: buildKilometerSplits(correctedStreams),
    metadata: {
      target_distance_meters: targetDistanceMeters,
      source_distance_meters: currentDistanceMeters,
      scale_factor: scaleFactor
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
    correctedLaps: buildKilometerSplits(correctedStreams),
    metadata: {
      target_moving_time_seconds: targetMovingTimeSeconds,
      source_moving_time_seconds: currentMovingTimeSeconds,
      scale_factor: scaleFactor
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
