import { ChartModel, ChartPoint, StreamSeries, WorkoutData } from "../types/workout";
import {
  Y_TICK_COUNT,
  buildChartPaths,
  buildTickPositions,
  buildTicks,
  buildXAxis,
  clamp,
  distanceResampleOptions,
  quantile,
  resampleByDistance,
  smoothSeries
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
  const samples = streams.time?.length
    ? resampleByDistance(streams.distance, streams.time, streams.heartrate, distanceResampleOptions(total, "hr"))
    : [];
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
  const maxHr = Math.ceil((Math.max(coreHighHr, (workout?.average_heartrate ?? coreHighHr) + 8) + 4) / 5) * 5;
  const displaySeries = smoothSeries(rawPoints.map((point) => clamp(point.y, minHr, maxHr)), 3);
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
