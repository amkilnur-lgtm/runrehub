import { ChartModel, ChartPoint, StreamSeries, WorkoutData } from "../types/workout";
import {
  Y_TICK_COUNT,
  blendExtremesTowardRaw,
  buildChartPaths,
  buildTickPositions,
  buildTicks,
  buildXAxis,
  buildXAxisPositions,
  clamp,
  medianFilter,
  quantile,
  smoothSeries,
  suppressTransientSpikes
} from "./chart-utils";

export function computeWindowedPace(distance: number[], time: number[], windowSeconds: number) {
  const size = Math.min(distance.length, time.length);
  if (size < 3) {
    return [];
  }

  const halfWindow = Math.max(2, Math.floor(windowSeconds / 2));
  const result: number[] = [];

  for (let index = 0; index < size; index += 1) {
    const centerTime = time[index];
    if (!Number.isFinite(centerTime)) {
      result.push(Number.NaN);
      continue;
    }

    let left = index;
    while (left > 0 && centerTime - time[left] < halfWindow) {
      left -= 1;
    }

    let right = index;
    while (right < size - 1 && time[right] - centerTime < halfWindow) {
      right += 1;
    }

    const deltaTime = time[right] - time[left];
    const deltaDistance = distance[right] - distance[left];

    if (
      !Number.isFinite(deltaTime) ||
      !Number.isFinite(deltaDistance) ||
      deltaTime <= 0 ||
      deltaDistance <= 0.5
    ) {
      result.push(Number.NaN);
      continue;
    }

    result.push((deltaTime / deltaDistance) * 1000);
  }

  return result;
}

export function formatPaceSeconds(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return "—";
  }

  const rounded = Math.round(totalSeconds);
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function preparePaceChart(
  streams: StreamSeries,
  workout: WorkoutData["workout"] | null
): ChartModel | null {
  if (!streams?.distance?.length) {
    return null;
  }

  const xAxis = buildXAxis(streams, workout?.distance_meters ?? 0);
  const derivedPace = streams.time.length
    ? computeWindowedPace(streams.distance, streams.time, 18)
    : streams.velocity_smooth.map((speed) =>
        Number.isFinite(speed) && speed > 0 ? 1000 / speed : Number.NaN
      );
  const size = Math.min(xAxis.pointsX.length, derivedPace.length);
  const validPaces: number[] = [];
  const rawPoints: ChartPoint[] = [];

  for (let index = 0; index < size; index += 1) {
    const x = xAxis.pointsX[index];
    const paceValue = derivedPace[index];

    if (!Number.isFinite(x) || x < 0) {
      continue;
    }

    let paceSeconds: number | null = null;
    if (Number.isFinite(paceValue) && paceValue >= 170 && paceValue <= 1200) {
      paceSeconds = paceValue;
      validPaces.push(paceValue);
    }

    rawPoints.push({
      x,
      y: paceSeconds ?? Number.NaN
    });
  }

  if (rawPoints.length < 2 || validPaces.length < 2) {
    return null;
  }

  const averagePace = workout?.average_speed ? 1000 / workout.average_speed : quantile(validPaces, 0.5);
  const bestPace = Math.min(...validPaces);
  const coreFastPace = quantile(validPaces, 0.03);
  const coreSlowPace = quantile(validPaces, 0.97);
  const fastBound = clamp(
    Math.floor((Math.min(coreFastPace, averagePace - 10, bestPace) - 15) / 20) * 20,
    180,
    1200
  );
  const slowBound = clamp(
    Math.ceil((Math.max(coreSlowPace, averagePace + 45) + 15) / 20) * 20,
    fastBound + 80,
    1200
  );

  const displayBase = rawPoints.map((point) =>
    Number.isFinite(point.y) ? clamp(point.y, fastBound, slowBound) : slowBound
  );
  const deSpiked = suppressTransientSpikes(displayBase, 65);
  const medianSmoothed = medianFilter(deSpiked, 5);
  const lightlySmoothed = smoothSeries(medianSmoothed, 5);
  const displaySeries = blendExtremesTowardRaw(displayBase, lightlySmoothed, {
    preserveHighThreshold: 32,
    preserveHighFactor: 0.72,
    preserveLowThreshold: 20,
    preserveLowFactor: 0.45
  });
  const points = rawPoints.map((point, index) => ({
    x: point.x,
    y: displaySeries[index]
  }));

  const { linePath, areaPath } = buildChartPaths(points, fastBound, slowBound, true);

  return {
    linePath,
    areaPath,
    yTicks: buildTicks(fastBound, slowBound, Y_TICK_COUNT),
    yTickPositions: buildTickPositions(Y_TICK_COUNT + 1),
    xTicks: xAxis.xTicks,
    xTickLabels: xAxis.xTickLabels,
    xTickPositions: buildXAxisPositions(xAxis.xTicks.length),
    axisCaption: "МИН/КМ",
    xLabel: xAxis.xLabel,
    summaryLeft: workout?.average_speed ? formatPaceSeconds(1000 / workout.average_speed) : "—",
    summaryLeftLabel: "Средний",
    summaryRight: formatPaceSeconds(bestPace),
    summaryRightLabel: "Лучший"
  };
}
