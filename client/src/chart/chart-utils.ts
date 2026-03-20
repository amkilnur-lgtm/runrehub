import { ChartPoint, StreamSeries } from "../types/workout";

export const CHART_WIDTH = 620;
export const CHART_HEIGHT = 220;
export const CHART_INSET_X = 2;
export const CHART_INSET_TOP = 12;
export const CHART_INSET_BOTTOM = 12;
export const Y_TICK_COUNT = 4;
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
  return `${(distanceMeters / 1000).toFixed(1)}`;
}

export function buildXAxis(streams: StreamSeries, fallbackDistance: number) {
  const maxDistance = streams?.distance?.[streams!.distance.length - 1] ?? fallbackDistance;
  const xTicks = buildLinearTicks(maxDistance);
  return {
    pointsX: streams?.distance ?? [],
    xTicks,
    xTickLabels: xTicks.map(formatDistanceTick),
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
    const yRatio = clamp((point.y - minY) / yRange, 0, 1);
    const normalized = invertY ? yRatio : 1 - yRatio;
    const y = CHART_INSET_TOP + normalized * drawableHeight;
    return { x, y };
  });

  const linePath = projected
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");

  const first = projected[0];
  const last = projected[projected.length - 1];
  const baseY = CHART_HEIGHT - CHART_INSET_BOTTOM;
  const areaPath = `${linePath} L ${last.x.toFixed(2)} ${baseY.toFixed(2)} L ${first.x.toFixed(2)} ${baseY.toFixed(2)} Z`;

  return { linePath, areaPath };
}
