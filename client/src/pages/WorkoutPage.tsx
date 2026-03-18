import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { api } from "../api";
import { formatDate, formatDistance, formatDuration, formatPace } from "../lib";

type StreamSeries = {
  distance: number[];
  time: number[];
  heartrate: number[];
  velocity_smooth: number[];
} | null;

type WorkoutData = {
  workout: {
    id: number;
    name: string;
    start_date: string;
    distance_meters: number;
    moving_time_seconds: number;
    elevation_gain: number;
    average_speed: number | null;
    average_heartrate: number | null;
    max_heartrate?: number | null;
    athlete_name?: string;
    athlete_id?: number;
  };
  laps: Array<{
    id: number;
    name: string | null;
    distance_meters: number;
    elapsed_time_seconds: number;
    average_speed: number | null;
    average_heartrate: number | null;
    elevation_gain: number | null;
  }>;
  streams: StreamSeries;
};

type ChartPoint = {
  x: number;
  y: number;
};

type ChartModel = {
  linePath: string;
  areaPath: string;
  yTicks: number[];
  yTickPositions: string[];
  xTicks: number[];
  xTickLabels: string[];
  axisCaption: string;
  xLabel: string;
  summaryLeft: string;
  summaryLeftLabel: string;
  summaryRight: string;
  summaryRightLabel: string;
};

const CHART_WIDTH = 620;
const CHART_HEIGHT = 220;
const CHART_INSET_X = 12;
const CHART_INSET_TOP = 12;
const CHART_INSET_BOTTOM = 12;
const Y_TICK_COUNT = 4;
const X_TICK_COUNT = 6;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function quantile(values: number[], ratio: number) {
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

function smoothSeries(values: number[], windowSize: number) {
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

function formatPaceSeconds(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return "—";
  }

  const rounded = Math.round(totalSeconds);
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}/км`;
}

function formatHeartRate(value: number | null | undefined) {
  return value ? `${Math.round(value)} уд/мин` : "—";
}

function formatElevation(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }

  const rounded = Math.round(value);
  if (rounded === 0) {
    return "0";
  }

  return `${rounded}`;
}

function buildTicks(min: number, max: number, count: number, descending = false) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return [];
  }

  const ticks =
    min === max
      ? [min]
      : Array.from({ length: count + 1 }, (_, index) => min + ((max - min) * index) / count);

  return descending ? ticks.reverse() : ticks;
}

function buildLinearTicks(maxValue: number) {
  if (!Number.isFinite(maxValue) || maxValue <= 0) {
    return [];
  }

  return Array.from({ length: X_TICK_COUNT }, (_, index) => (maxValue * index) / (X_TICK_COUNT - 1));
}

function formatElapsedTick(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return "0:00";
  }

  const rounded = Math.round(totalSeconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatDistanceTick(distanceMeters: number) {
  return `${(distanceMeters / 1000).toFixed(1)}`;
}

function buildXAxis(streams: StreamSeries, fallbackDistance: number) {
  if (streams?.time?.length) {
    const maxTime = streams.time[streams.time.length - 1] ?? 0;
    const xTicks = buildLinearTicks(maxTime);
    return {
      pointsX: streams.time,
      xTicks,
      xTickLabels: xTicks.map(formatElapsedTick),
      xLabel: "Время (ч:м:с)"
    };
  }

  const maxDistance = streams?.distance?.[streams.distance.length - 1] ?? fallbackDistance;
  const xTicks = buildLinearTicks(maxDistance);
  return {
    pointsX: streams?.distance ?? [],
    xTicks,
    xTickLabels: xTicks.map(formatDistanceTick),
    xLabel: "Дистанция (км)"
  };
}

function buildTickPositions(count: number) {
  if (count <= 1) {
    return ["50%"];
  }

  const drawableHeight = CHART_HEIGHT - CHART_INSET_TOP - CHART_INSET_BOTTOM;
  return Array.from({ length: count }, (_, index) => {
    const y = CHART_INSET_TOP + (drawableHeight * index) / (count - 1);
    return `${(y / CHART_HEIGHT) * 100}%`;
  });
}

function buildChartPaths(points: ChartPoint[], minY: number, maxY: number, invertY: boolean) {
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

function preparePaceChart(streams: StreamSeries, workout: WorkoutData["workout"] | null): ChartModel | null {
  if (!streams?.distance?.length || !streams?.velocity_smooth?.length) {
    return null;
  }

  const xAxis = buildXAxis(streams, workout?.distance_meters ?? 0);
  const size = Math.min(xAxis.pointsX.length, streams.velocity_smooth.length);
  const validPaces: number[] = [];
  const rawPoints: ChartPoint[] = [];

  for (let index = 0; index < size; index += 1) {
    const x = xAxis.pointsX[index];
    const speed = streams.velocity_smooth[index];

    if (!Number.isFinite(x) || x < 0) {
      continue;
    }

    let paceSeconds: number | null = null;
    if (Number.isFinite(speed) && speed > 0) {
      const candidate = 1000 / speed;
      if (candidate >= 170 && candidate <= 1200) {
        paceSeconds = candidate;
        validPaces.push(candidate);
      }
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
  const fastBound = clamp(Math.floor((Math.min(...validPaces, averagePace) - 10) / 10) * 10, 170, 1200);
  const slowBound = clamp(Math.ceil((Math.max(...validPaces, averagePace) + 10) / 10) * 10, fastBound + 40, 1200);

  const normalized = rawPoints.map((point) =>
    Number.isFinite(point.y) ? clamp(point.y, fastBound, slowBound) : slowBound
  );
  const smoothed = smoothSeries(normalized, 5);
  const points = rawPoints.map((point, index) => ({
    x: point.x,
    y: smoothed[index]
  }));

  const { linePath, areaPath } = buildChartPaths(points, fastBound, slowBound, true);

  return {
    linePath,
    areaPath,
    yTicks: buildTicks(fastBound, slowBound, Y_TICK_COUNT),
    yTickPositions: buildTickPositions(Y_TICK_COUNT + 1),
    xTicks: xAxis.xTicks,
    xTickLabels: xAxis.xTickLabels,
    axisCaption: "МИН/КМ",
    xLabel: xAxis.xLabel,
    summaryLeft: formatPace(workout?.average_speed),
    summaryLeftLabel: "Средний",
    summaryRight: formatPaceSeconds(bestPace),
    summaryRightLabel: "Лучший"
  };
}

function prepareHeartRateChart(streams: StreamSeries, workout: WorkoutData["workout"] | null): ChartModel | null {
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
    axisCaption: "УД/МИН",
    xLabel: xAxis.xLabel,
    summaryLeft: formatHeartRate(workout?.average_heartrate),
    summaryLeftLabel: "Средний",
    summaryRight: formatHeartRate(workout?.max_heartrate ?? Math.max(...validHr)),
    summaryRightLabel: "Максимум"
  };
}

function StreamChart({
  title,
  model,
  color,
  fill,
  formatter
}: {
  title: string;
  model: ChartModel | null;
  color: string;
  fill: string;
  formatter: (value: number) => string;
}) {
  if (!model) {
    return (
      <div className="chart-card">
        <div className="chart-title-row">
          <strong>{title}</strong>
        </div>
        <div className="chart-empty muted">Нет данных Strava для этого графика.</div>
      </div>
    );
  }

  return (
    <div className="chart-card">
      <div className="chart-title-row">
        <strong>{title}</strong>
        <span className="muted chart-axis-caption">{model.axisCaption}</span>
      </div>
      <div className="chart-metrics">
        <div>
          <div className="chart-metric-value">{model.summaryLeft}</div>
          <div className="muted">{model.summaryLeftLabel}</div>
        </div>
        <div>
          <div className="chart-metric-value">{model.summaryRight}</div>
          <div className="muted">{model.summaryRightLabel}</div>
        </div>
      </div>
      <div className="chart-frame">
        <div className="chart-grid-wrap">
          <div className="chart-y-axis">
            {model.yTicks.map((tick, index) => (
              <span key={`${tick}-${index}`} style={{ top: model.yTickPositions[index] }}>
                {formatter(tick)}
              </span>
            ))}
          </div>
          <div className="chart-grid">
            {model.yTicks.map((tick, index) => (
              <div
                key={`${tick}-${index}`}
                className="chart-grid-line"
                style={{ top: model.yTickPositions[index] }}
              />
            ))}
            <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="chart-svg" preserveAspectRatio="none">
              <defs>
                <linearGradient id={`${title}-gradient`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={fill} />
                  <stop offset="100%" stopColor="rgba(255,255,255,0.04)" />
                </linearGradient>
              </defs>
              <path d={model.areaPath} fill={`url(#${title}-gradient)`} />
              <path
                d={model.linePath}
                fill="none"
                stroke={color}
                strokeWidth="1.35"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </svg>
          </div>
        </div>
      </div>
      <div className="chart-x-axis">
        {model.xTicks.map((tick, index) => (
          <span key={`${tick}-${index}`}>{model.xTickLabels[index]}</span>
        ))}
      </div>
      <div className="chart-x-label muted">{model.xLabel}</div>
    </div>
  );
}

export function WorkoutPage({ mode }: { mode: "trainer" | "athlete" }) {
  const params = useParams();
  const [data, setData] = useState<WorkoutData | null>(null);

  useEffect(() => {
    const prefix = mode === "trainer" ? "/api/trainer/workouts/" : "/api/athlete/workouts/";
    void api<WorkoutData>(`${prefix}${params.id}`).then(setData);
  }, [mode, params.id]);

  const backHref =
    mode === "trainer" && data?.workout.athlete_id
      ? `/trainer/athletes/${data.workout.athlete_id}`
      : "/athlete";

  const paceChart = useMemo(() => preparePaceChart(data?.streams ?? null, data?.workout ?? null), [data]);
  const heartRateChart = useMemo(
    () => prepareHeartRateChart(data?.streams ?? null, data?.workout ?? null),
    [data]
  );

  return (
    <div className="stack">
      <section className="card">
        <Link to={backHref} className="inline-link">
          Назад
        </Link>
        <h2>{data?.workout.name}</h2>
        <p className="muted">
          {mode === "trainer" && data?.workout.athlete_name ? `${data.workout.athlete_name} · ` : ""}
          {data?.workout.start_date ? formatDate(data.workout.start_date) : ""}
        </p>
        <div className="grid four-columns">
          <div className="card inset-card">
            <div className="muted">Километраж</div>
            <div className="stat-value">{data ? formatDistance(data.workout.distance_meters) : "—"}</div>
          </div>
          <div className="card inset-card">
            <div className="muted">Общее время</div>
            <div className="stat-value">{data ? formatDuration(data.workout.moving_time_seconds) : "—"}</div>
          </div>
          <div className="card inset-card">
            <div className="muted">Средний пульс</div>
            <div className="stat-value">{formatHeartRate(data?.workout.average_heartrate)}</div>
          </div>
          <div className="card inset-card">
            <div className="muted">Набор высоты</div>
            <div className="stat-value">{data ? `${Math.round(data.workout.elevation_gain ?? 0)} м` : "—"}</div>
          </div>
        </div>
      </section>

      <section className="grid workout-layout">
        <div className="card">
          <h2>Отрезки</h2>
          {data?.laps.length ? (
            <div className="compact-laps">
              <div className="compact-laps-head muted">
                <span>Отрезок</span>
                <span>Км</span>
                <span>Темп</span>
                <span title="Пульс">♥</span>
                <span title="Набор/сброс">↕</span>
              </div>
              {data.laps.map((lap, index) => (
                <div key={lap.id} className="compact-lap-row">
                  <span className="lap-name">{lap.name || `Lap ${index + 1}`}</span>
                  <span>{formatDistance(lap.distance_meters)}</span>
                  <span>{formatPace(lap.average_speed)}</span>
                  <span>{lap.average_heartrate ? `${Math.round(lap.average_heartrate)}` : "—"}</span>
                  <span>{formatElevation(lap.elevation_gain)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="muted">Strava не вернула отдельные отрезки для этой тренировки.</div>
          )}
        </div>

        <div className="chart-column">
          <StreamChart
            title="Темп"
            model={paceChart}
            color="#2476e5"
            fill="rgba(36, 118, 229, 0.42)"
            formatter={formatPaceSeconds}
          />
          <StreamChart
            title="Пульс"
            model={heartRateChart}
            color="#d53a3a"
            fill="rgba(213, 58, 58, 0.34)"
            formatter={(value) => `${Math.round(value)}`}
          />
        </div>
      </section>
    </div>
  );
}
