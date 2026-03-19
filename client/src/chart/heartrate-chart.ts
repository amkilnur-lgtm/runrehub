import { ChartModel, ChartPoint, StreamSeries, WorkoutData } from "../types/workout";
import {
  Y_TICK_COUNT,
  buildChartPaths,
  buildTickPositions,
  buildTicks,
  buildXAxis,
  buildXAxisPositions,
  smoothSeries
} from "./chart-utils";

export function formatHeartRate(value: number | null | undefined) {
  return value ? `${Math.round(value)} уд/мин` : "—";
}

export function prepareHeartRateChart(streams: StreamSeries, workout: WorkoutData["workout"] | null): ChartModel | null {
  if (!streams?.distance?.length || !streams?.heartrate?.length) {
    return null;
  }

  const xAxis = buildXAxis(streams, workout?.distance_meters ?? 0);
  const size = Math.min(xAxis.pointsX.length, streams.heartrate.length);
  const rawPoints: ChartPoint[] = [];
  const validHr: number[] = [];

  for (let index = 0; index < size; index += 1) {
    const x = xAxis.pointsX[index];
    const hr = streams.heartrate[index];

    if (!Number.isFinite(x) || x < 0 || !Number.isFinite(hr) || hr <= 0) {
      continue;
    }

    rawPoints.push({ x, y: hr });
    validHr.push(hr);
  }

  if (rawPoints.length < 2 || validHr.length < 2) {
    return null;
  }

  const minHr = Math.max(60, Math.floor((Math.min(...validHr) - 5) / 5) * 5);
  const maxHr = Math.ceil((Math.max(...validHr) + 5) / 5) * 5;
  const smoothed = smoothSeries(rawPoints.map((point) => point.y), 7);
  const points = rawPoints.map((point, index) => ({
    x: point.x,
    y: smoothed[index]
  }));
  const { linePath, areaPath } = buildChartPaths(points, minHr, maxHr, false);

  return {
    linePath,
    areaPath,
    yTicks: buildTicks(minHr, maxHr, Y_TICK_COUNT, true),
    yTickPositions: buildTickPositions(Y_TICK_COUNT + 1),
    xTicks: xAxis.xTicks,
    xTickLabels: xAxis.xTickLabels,
    xTickPositions: buildXAxisPositions(xAxis.xTicks.length),
    axisCaption: "УД/МИН",
    xLabel: xAxis.xLabel,
    summaryLeft: formatHeartRate(workout?.average_heartrate),
    summaryLeftLabel: "Средний",
    summaryRight: formatHeartRate(workout?.max_heartrate ?? Math.max(...validHr)),
    summaryRightLabel: "Максимум"
  };
}
