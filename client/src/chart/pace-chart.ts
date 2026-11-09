import { ChartModel, ChartPoint, StreamSeries, WorkoutData } from "../types/workout";
import {
  Y_TICK_COUNT,
  buildChartPaths,
  buildTickPositions,
  buildTicks,
  buildXAxis,
  clamp,
  distanceResampleOptions,
  medianFilter,
  quantile,
  resampleByDistance,
  smoothSeries
} from "./chart-utils";
import { downsample } from "./chart-utils";

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
  workout: WorkoutData["workout"] | null,
  // рабочие отрезки (м от старта): внутри них окно короткое, чтобы отрезки было видно,
  // вне их — длинное, чтобы шум GPS на разминке и отдыхе не рисовал «пилу»
  workRanges: [number, number][] = []
): ChartModel | null {
  if (!streams?.distance?.length) {
    return null;
  }

  const xAxis = buildXAxis(streams, workout?.distance_meters ?? 0);
  const total = streams.distance[streams.distance.length - 1] ?? 0;
  const validPaces: number[] = [];
  const rawPoints: ChartPoint[] = [];
  if (streams.time.length) {
    const base = distanceResampleOptions(total, "pace");
    const long = resampleByDistance(streams.distance, streams.time, null, { step: base.step, window: 300 });
    // окно по длине отрезка: у коротких ускорений 100 м (видно пик), у длинных 400 м
    // (иначе шум GPS рисует ложные пики внутри ровного отрезка)
    const windowed = (window: number) => {
      const samples = workRanges.length ? resampleByDistance(streams.distance, streams.time, null, { step: base.step, window }) : [];
      // одиночные выбросы GPS гасим медианой по 5 соседям
      const paces = medianFilter(samples.map((sample) => sample.pace), 5);
      return new Map(samples.map((sample, index) => [Math.round(sample.x), paces[index]!]));
    };
    const shortByX = windowed(100);
    const mediumByX = windowed(400);
    const rangeAt = (x: number) => workRanges.find(([from, to]) => x >= from - 30 && x <= to + 30);
    for (const sample of long) {
      const range = rangeAt(sample.x);
      const byX = range && range[1] - range[0] < 400 ? shortByX : mediumByX;
      const pace = range ? byX.get(Math.round(sample.x)) ?? sample.pace : sample.pace;
      // быстрее 1:40 /км любитель не бежит — это скачок GPS
      const ok = pace >= 100 && pace <= 1200;
      if (ok) validPaces.push(pace);
      rawPoints.push({ x: sample.x, y: ok ? pace : Number.NaN });
    }
  }

  if (rawPoints.length < 2 || validPaces.length < 2) {
    return null;
  }

  const averagePace = workout?.average_speed ? 1000 / workout.average_speed : quantile(validPaces, 0.5);
  const bestPace = Math.min(...validPaces);
  const coreFastPace = quantile(validPaces, 0.03);
  const coreSlowPace = quantile(validPaces, 0.9);
  // верх шкалы — по самым быстрым рабочим отрезкам (ускорения по 2:20 не упираются
  // в потолок), а не по одиночному выбросу: вне отрезков берём 3% самых быстрых точек
  const workPaces = rawPoints
    .filter((point) => Number.isFinite(point.y) && workRanges.some(([from, to]) => point.x >= from && point.x <= to))
    .map((point) => point.y);
  const fastestWork = workPaces.length ? quantile(workPaces, 0.02) : Number.POSITIVE_INFINITY;
  const fastBound = clamp(
    Math.floor((Math.min(coreFastPace, averagePace - 10, fastestWork) - 15) / 20) * 20,
    120,
    1200
  );
  // паузы и шаг не растягивают шкалу: медленный край — не дальше 2:30 от среднего
  const slowBound = clamp(
    Math.ceil((Math.min(Math.max(coreSlowPace, averagePace + 45), averagePace + 150) + 15) / 20) * 20,
    fastBound + 80,
    1200
  );

  // ряд уже сглажен окном по дистанции — только подрезаем края шкалы и чуть сглаживаем
  const displaySeries = smoothSeries(
    rawPoints.map((point) => (Number.isFinite(point.y) ? clamp(point.y, fastBound, slowBound) : slowBound)),
    3
  );
  const points = rawPoints.map((point, index) => ({
    x: point.x,
    y: Number.isFinite(point.y) ? displaySeries[index]! : Number.NaN
  }));

  const { linePath, areaPath } = buildChartPaths(points, fastBound, slowBound, true);

  return {
    linePath,
    areaPath,
    yTicks: buildTicks(fastBound, slowBound, Y_TICK_COUNT),
    yTickPositions: buildTickPositions(Y_TICK_COUNT + 1),
    xTicks: xAxis.xTicks,
    xTickLabels: xAxis.xTickLabels,
    xTickPositions: xAxis.xTickPositions,
    axisCaption: "МИН/КМ",
    xLabel: xAxis.xLabel,
    summaryLeft: workout?.average_speed ? formatPaceSeconds(1000 / workout.average_speed) : "—",
    summaryLeftLabel: "Средний",
    summaryRight: formatPaceSeconds(bestPace),
    summaryRightLabel: "Лучший",
    series: downsample(points.filter((point) => Number.isFinite(point.y)), 700),
    yMin: fastBound,
    yMax: slowBound,
    invertY: true,
    xMax: points[points.length - 1]?.x ?? 0
  };
}
