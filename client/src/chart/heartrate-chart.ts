import { ChartModel, ChartPoint, StreamSeries, WorkoutData } from "../types/workout";
import {
  Y_TICK_COUNT,
  buildChartPaths,
  buildTickPositions,
  buildTicks,
  buildXAxis,
  clamp,
  distanceResampleOptions,
  quantile
} from "./chart-utils";
import { downsample } from "./chart-utils";

export function formatHeartRate(value: number | null | undefined) {
  return value ? `${Math.round(value)} уд/мин` : "—";
}

export function prepareHeartRateChart(streams: StreamSeries, workout: WorkoutData["workout"] | null): ChartModel | null {
  if (!streams?.distance?.length || !streams?.heartrate?.length) {
    return null;
  }

  const xAxis = buildXAxis(streams, workout?.distance_meters ?? 0);
  const total = streams.distance[streams.distance.length - 1] ?? 0;
  const rawPoints: ChartPoint[] = [];
  const validHr: number[] = [];
  // пульс не сглаживаем окном: тренеру важен пик в конце отрезка. Берём максимум в каждом шаге
  // дистанции — пики сохраняются, а стояние на месте (дистанция не растёт) схлопывается в одну точку.
  const step = distanceResampleOptions(total, "hr").step;
  const samples: { x: number; value: number }[] = [];
  let bucketStart = -Infinity;
  for (let index = 0; index < Math.min(streams.distance.length, streams.heartrate.length); index += 1) {
    const d = streams.distance[index]!;
    const hr = streams.heartrate[index]!;
    if (!Number.isFinite(d) || !Number.isFinite(hr)) continue;
    if (d - bucketStart >= step || !samples.length) {
      samples.push({ x: d, value: hr });
      bucketStart = d;
    } else if (hr > samples[samples.length - 1]!.value) {
      samples[samples.length - 1]!.value = hr;
    }
  }
  for (const sample of samples) {
    if (!Number.isFinite(sample.value) || sample.value < 60 || sample.value > 230) continue;
    rawPoints.push({ x: sample.x, y: sample.value });
    validHr.push(sample.value);
  }

  if (rawPoints.length < 2 || validHr.length < 2) {
    return null;
  }

  const coreLowHr = quantile(validHr, 0.04);
  const coreHighHr = quantile(validHr, 0.97);
  const minHr = Math.max(60, Math.floor((coreLowHr - 4) / 5) * 5);
  // верх шкалы — по настоящему максимуму, чтобы пик не срезался
  const maxHr = Math.ceil((Math.max(coreHighHr, Math.max(...validHr), (workout?.average_heartrate ?? coreHighHr) + 8) + 3) / 5) * 5;
  const displaySeries = rawPoints.map((point) => clamp(point.y, minHr, maxHr));
  const points = rawPoints.map((point, index) => ({
    x: point.x,
    y: displaySeries[index]!
  }));
  const { linePath, areaPath } = buildChartPaths(points, minHr, maxHr, false);

  return {
    linePath,
    areaPath,
    yTicks: buildTicks(minHr, maxHr, Y_TICK_COUNT, true),
    yTickPositions: buildTickPositions(Y_TICK_COUNT + 1),
    xTicks: xAxis.xTicks,
    xTickLabels: xAxis.xTickLabels,
    xTickPositions: xAxis.xTickPositions,
    axisCaption: "УД/МИН",
    xLabel: xAxis.xLabel,
    summaryLeft: formatHeartRate(workout?.average_heartrate),
    summaryLeftLabel: "Средний",
    summaryRight: formatHeartRate(workout?.max_heartrate ?? Math.max(...validHr)),
    summaryRightLabel: "Максимум",
    series: downsample(points.filter((point) => Number.isFinite(point.y)), 700),
    yMin: minHr,
    yMax: maxHr,
    invertY: false,
    xMax: points[points.length - 1]?.x ?? 0
  };
}
