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
// Склеиваем только реально вложенные области (чередующиеся серии), а не просто
// идущие подряд: 2 км темпа, серия 400-ток и километр после неё — три подписи.
const LABEL_GROUP_OVERLAP_PERCENT = 0.2;

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
      setIndex: segment.set_index,
      from: left,
      to: right
    });
  }

  // Подпись — одна на область серии, от первого повтора до последнего. Области
  // разных серий бывают вложены друг в друга: в связке «800 + рывок 200» серии
  // чередуются, и две подписи иначе оказываются в одной точке. Пересекающиеся
  // области склеиваем в общую подпись «5×800 м + 5×200 м».
  const spans = new Map<number, { from: number; to: number }>();
  for (const band of bands) {
    const span = spans.get(band.setIndex);
    spans.set(band.setIndex, {
      from: span ? Math.min(span.from, band.from) : band.from,
      to: span ? Math.max(span.to, band.to) : band.to
    });
  }

  const groups: Array<{ from: number; to: number; setIndexes: number[] }> = [];
  for (const [setIndex, span] of [...spans.entries()].sort((a, b) => a[1].from - b[1].from)) {
    const current = groups[groups.length - 1];
    if (current && span.from <= current.to - LABEL_GROUP_OVERLAP_PERCENT) {
      current.to = Math.max(current.to, span.to);
      current.setIndexes.push(setIndex);
      continue;
    }

    groups.push({ from: span.from, to: span.to, setIndexes: [setIndex] });
  }

  const labels: IntervalBandLabel[] = groups.map((group) => ({
    center: `${(group.from + group.to) / 2}%`,
    label: group.setIndexes
      .sort((a, b) => a - b)
      .map((index) => structure.sets[index]?.label)
      .filter(Boolean)
      .join(" + ")
  }));

  return { bands, labels };
}
