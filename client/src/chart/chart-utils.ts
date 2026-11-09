import { ChartPoint, StreamSeries } from "../types/workout";

export const CHART_WIDTH = 620;
export const CHART_HEIGHT = 220;
export const CHART_INSET_X = 2;
export const CHART_INSET_TOP = 12;
export const CHART_INSET_BOTTOM = 12;
// три линии сетки с подписями (client/DESIGN.md → «Графики»)
export const Y_TICK_COUNT = 2;
export const X_TICK_COUNT = 6;

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function quantile(values: number[], ratio: number) {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * ratio;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return sorted[lower];
  }

  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

export function smoothSeries(values: number[], windowSize: number) {
  if (values.length < 3 || windowSize < 2) {
    return values;
  }

  const radius = Math.floor(windowSize / 2);
  return values.map((_, index) => {
    const start = Math.max(0, index - radius);
    const end = Math.min(values.length - 1, index + radius);
    const slice = values.slice(start, end + 1);
    const sum = slice.reduce((total, value) => total + value, 0);
    return sum / slice.length;
  });
}

export function median(values: number[]) {
  if (!values.length) {
    return Number.NaN;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function medianFilter(values: number[], windowSize: number) {
  if (values.length < 3 || windowSize < 2) {
    return values;
  }

  const radius = Math.floor(windowSize / 2);
  return values.map((_, index) => {
    const start = Math.max(0, index - radius);
    const end = Math.min(values.length - 1, index + radius);
    return median(values.slice(start, end + 1));
  });
}

export function suppressTransientSpikes(values: number[], threshold: number) {
  if (values.length < 3 || threshold <= 0) {
    return values;
  }

  const result = [...values];

  for (let index = 1; index < values.length - 1; index += 1) {
    const previous = result[index - 1];
    const current = result[index];
    const next = values[index + 1];

    if (![previous, current, next].every(Number.isFinite)) {
      continue;
    }

    const neighborMean = (previous + next) / 2;
    if (Math.abs(current - neighborMean) > threshold) {
      result[index] = neighborMean;
    }
  }

  return result;
}

export function blendExtremesTowardRaw(
  rawValues: number[],
  smoothedValues: number[],
  {
    preserveHighThreshold,
    preserveHighFactor,
    preserveLowThreshold,
    preserveLowFactor
  }: {
    preserveHighThreshold: number;
    preserveHighFactor: number;
    preserveLowThreshold: number;
    preserveLowFactor: number;
  }
) {
  return smoothedValues.map((smoothed, index) => {
    const raw = rawValues[index];
    if (!Number.isFinite(raw) || !Number.isFinite(smoothed)) {
      return smoothed;
    }

    const delta = raw - smoothed;
    if (delta >= preserveHighThreshold) {
      return smoothed + delta * preserveHighFactor;
    }

    if (delta <= -preserveLowThreshold) {
      return smoothed + delta * preserveLowFactor;
    }

    return smoothed;
  });
}

export function buildTicks(min: number, max: number, count: number, descending = false) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return [];
  }

  const ticks =
    min === max
      ? [min]
      : Array.from({ length: count + 1 }, (_, index) => min + ((max - min) * index) / count);

  return descending ? ticks.reverse() : ticks;
}

export function buildLinearTicks(maxValue: number) {
  if (!Number.isFinite(maxValue) || maxValue <= 0) {
    return [];
  }

  return Array.from({ length: X_TICK_COUNT }, (_, index) => (maxValue * index) / (X_TICK_COUNT - 1));
}

export function formatDistanceTick(distanceMeters: number) {
  const km = distanceMeters / 1000;
  return Number.isInteger(Math.round(km * 10) / 10) ? String(Math.round(km)) : km.toFixed(1).replace(".", ",");
}

// круглые километры по оси X: 0 · 2 · 4 · 6 (шаг 0,5 / 1 / 2 / 5 / 10 / 20 км, не больше 6 подписей)
function niceDistanceTicks(maxDistance: number) {
  const km = maxDistance / 1000;
  const step = [0.5, 1, 2, 5, 10, 20, 50].find((candidate) => km / candidate <= 5) ?? 50;
  const ticks: number[] = [];
  for (let value = 0; value <= km + 1e-9; value += step) ticks.push(Math.round(value * 1000));
  return ticks.length >= 2 ? ticks : [0, Math.round(maxDistance)];
}

export function buildXAxis(streams: StreamSeries, fallbackDistance: number) {
  const maxDistance = streams?.distance?.[streams!.distance.length - 1] ?? fallbackDistance;
  const xTicks = niceDistanceTicks(maxDistance);
  return {
    pointsX: streams?.distance ?? [],
    xTicks,
    xTickLabels: xTicks.map(formatDistanceTick),
    xTickPositions: xTicks.map((tick) => `${projectX(tick, maxDistance) * 100}%`),
    xLabel: "Дистанция (км)"
  };
}

export function buildTickPositions(count: number) {
  if (count <= 1) {
    return ["50%"];
  }

  const drawableHeight = CHART_HEIGHT - CHART_INSET_TOP - CHART_INSET_BOTTOM;
  return Array.from({ length: count }, (_, index) => {
    const y = CHART_INSET_TOP + (drawableHeight * index) / (count - 1);
    return `${(y / CHART_HEIGHT) * 100}%`;
  });
}

export function buildXAxisPositions(count: number) {
  if (count <= 1) {
    return ["0%"];
  }

  const drawableWidth = CHART_WIDTH - CHART_INSET_X * 2;
  return Array.from({ length: count }, (_, index) => {
    if (index === 0) {
      return "0%";
    }

    if (index === count - 1) {
      return "100%";
    }

    const x = CHART_INSET_X + (drawableWidth * index) / (count - 1);
    return `${(x / CHART_WIDTH) * 100}%`;
  });
}

export function buildChartPaths(points: ChartPoint[], minY: number, maxY: number, invertY: boolean) {
  if (points.length < 2) {
    return { linePath: "", areaPath: "" };
  }

  const maxX = points[points.length - 1].x || 1;
  const yRange = maxY - minY || 1;
  const drawableWidth = CHART_WIDTH - CHART_INSET_X * 2;
  const drawableHeight = CHART_HEIGHT - CHART_INSET_TOP - CHART_INSET_BOTTOM;

  const projected = points.map((point) => {
    const xRatio = clamp(point.x / maxX, 0, 1);
    const x = CHART_INSET_X + xRatio * drawableWidth;
    const yRatio = Number.isFinite(point.y) ? clamp((point.y - minY) / yRange, 0, 1) : 0;
    const normalized = invertY ? yRatio : 1 - yRatio;
    const y = CHART_INSET_TOP + normalized * drawableHeight;
    return { x, y };
  });

  // NaN — разрыв линии (пауза, остановка): новый отрезок начинается с «M»
  let penDown = false;
  const linePath = projected
    .map((point, index) => {
      if (!Number.isFinite(points[index]!.y)) {
        penDown = false;
        return "";
      }
      const command = penDown ? "L" : "M";
      penDown = true;
      return `${command} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
    })
    .filter(Boolean)
    .join(" ");

  const first = projected[0];
  const last = projected[projected.length - 1];
  const baseY = CHART_HEIGHT - CHART_INSET_BOTTOM;
  const areaPath = `${linePath} L ${last.x.toFixed(2)} ${baseY.toFixed(2)} L ${first.x.toFixed(2)} ${baseY.toFixed(2)} Z`;

  return { linePath, areaPath };
}

// равномерно прореживаем ряд для курсора (каждая N-я точка + последняя)
export function downsample<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const step = items.length / max;
  const result: T[] = [];
  for (let index = 0; index < max; index += 1) result.push(items[Math.floor(index * step)]!);
  result.push(items[items.length - 1]!);
  return result;
}

// доля высоты графика (0..1) для значения — та же проекция, что у линии
export function projectY(value: number, minY: number, maxY: number, invertY: boolean) {
  const drawableHeight = CHART_HEIGHT - CHART_INSET_TOP - CHART_INSET_BOTTOM;
  const yRatio = clamp((value - minY) / (maxY - minY || 1), 0, 1);
  const normalized = invertY ? yRatio : 1 - yRatio;
  return (CHART_INSET_TOP + normalized * drawableHeight) / CHART_HEIGHT;
}

// доля ширины графика (0..1) для дистанции и обратно
export function projectX(meters: number, xMax: number) {
  const drawableWidth = CHART_WIDTH - CHART_INSET_X * 2;
  return (CHART_INSET_X + clamp(meters / (xMax || 1), 0, 1) * drawableWidth) / CHART_WIDTH;
}

export function unprojectX(fraction: number, xMax: number) {
  const drawableWidth = CHART_WIDTH - CHART_INSET_X * 2;
  return clamp((fraction * CHART_WIDTH - CHART_INSET_X) / drawableWidth, 0, 1) * xMax;
}

// Ряд по дистанции, а не по точкам часов: каждые `step` метров — среднее за окно `window` м.
// Остановки выпадают сами (дистанция не растёт), шум GPS сглаживается окном.
// pace — сек/км по времени движения; value — средний показатель (пульс) за окно.
export function resampleByDistance(
  distance: number[],
  time: number[],
  values: number[] | null,
  options: { step: number; window: number }
) {
  const size = Math.min(distance.length, time.length, values ? values.length : Infinity);
  if (size < 3) return [];
  // накопленное время движения и сумма показателя × время
  const moving = new Float64Array(size);
  const weighted = new Float64Array(size);
  const dist = new Float64Array(size);
  let lastDistance = 0;
  for (let index = 0; index < size; index += 1) {
    const d = Number.isFinite(distance[index]) ? Math.max(distance[index]!, lastDistance) : lastDistance;
    dist[index] = d;
    if (index === 0) {
      lastDistance = d;
      continue;
    }
    const dt = time[index]! - time[index - 1]!;
    const dd = d - lastDistance;
    const isMoving = Number.isFinite(dt) && dt > 0 && dt <= 10 && dd > 0.2;
    moving[index] = moving[index - 1]! + (isMoving ? dt : 0);
    const value = values ? values[index]! : 0;
    weighted[index] = weighted[index - 1]! + (isMoving && Number.isFinite(value) && value > 0 ? value * dt : 0);
    lastDistance = d;
  }
  const total = dist[size - 1]!;
  const at = (target: number, series: Float64Array) => {
    let lo = 0;
    let hi = size - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (dist[mid]! < target) lo = mid + 1;
      else hi = mid;
    }
    if (lo === 0) return series[0]!;
    const d0 = dist[lo - 1]!;
    const d1 = dist[lo]!;
    const ratio = d1 > d0 ? (target - d0) / (d1 - d0) : 1;
    return series[lo - 1]! + (series[lo]! - series[lo - 1]!) * clamp(ratio, 0, 1);
  };
  const half = options.window / 2;
  const result: { x: number; pace: number; value: number }[] = [];
  for (let center = 0; center <= total; center += options.step) {
    const from = clamp(center - half, 0, total);
    const to = clamp(center + half, 0, total);
    const span = to - from;
    const movingTime = at(to, moving) - at(from, moving);
    if (span < options.window * 0.4 || movingTime <= 0) continue;
    result.push({
      x: center,
      pace: (movingTime / span) * 1000,
      value: values ? (at(to, weighted) - at(from, weighted)) / movingTime : Number.NaN
    });
  }
  return result;
}

// шаг и окно под длину пробежки: ~350 точек; окно темпа ~1/50 дистанции (60–250 м)
export function distanceResampleOptions(totalMeters: number, kind: "pace" | "hr") {
  const step = clamp(totalMeters / 350, 8, 60);
  const window = kind === "pace" ? clamp(totalMeters / 50, 60, 250) : clamp(totalMeters / 80, 50, 150);
  return { step, window };
}
