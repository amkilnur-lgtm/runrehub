import {
  IntervalBand,
  IntervalBandLabel,
  StreamSeries,
  WorkoutStructure
} from "../types/workout";
import { CHART_INSET_X, CHART_WIDTH, clamp } from "./chart-utils";

// Ось X у графиков — дистанция, а рабочие отрезки приходят с индексами стрима.
// Переводим индексы в проценты ширины графика тем же отображением, что и
// buildChartPaths, иначе полосы разъедутся с линией.
function positionPercent(distanceMeters: number, maxDistance: number) {
  const ratio = clamp(distanceMeters / (maxDistance || 1), 0, 1);
  const x = CHART_INSET_X + ratio * (CHART_WIDTH - CHART_INSET_X * 2);
  return (x / CHART_WIDTH) * 100;
}

export function buildIntervalBands(
  streams: StreamSeries,
  structure: WorkoutStructure | null
): { bands: IntervalBand[]; labels: IntervalBandLabel[] } {
  const distance = streams?.distance;
  if (!distance?.length || !structure?.segments.length) {
    return { bands: [], labels: [] };
  }

  const maxDistance = distance[distance.length - 1];
  if (!Number.isFinite(maxDistance) || maxDistance <= 0) {
    return { bands: [], labels: [] };
  }

  const spans = new Map<number, { from: number; to: number }>();
  const bands: IntervalBand[] = [];

  for (const segment of structure.segments) {
    const startIndex = segment.start_index;
    const endIndex = segment.end_index;
    if (startIndex === null || endIndex === null) {
      continue;
    }

    const from = distance[clamp(startIndex, 0, distance.length - 1)];
    const to = distance[clamp(endIndex, 0, distance.length - 1)];
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
      continue;
    }

    const left = positionPercent(from, maxDistance);
    const right = positionPercent(to, maxDistance);
    bands.push({
      left: `${left}%`,
      width: `${Math.max(right - left, 0.4)}%`,
      setIndex: segment.set_index
    });

    const span = spans.get(segment.set_index);
    spans.set(segment.set_index, {
      from: span ? Math.min(span.from, left) : left,
      to: span ? Math.max(span.to, right) : right
    });
  }

  const labels: IntervalBandLabel[] = [];
  structure.sets.forEach((set, index) => {
    const span = spans.get(index);
    if (!span) {
      return;
    }

    labels.push({
      left: `${span.from}%`,
      width: `${Math.max(span.to - span.from, 0.4)}%`,
      label: set.label
    });
  });

  return { bands, labels };
}
