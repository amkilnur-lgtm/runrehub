import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { api } from "../api";
import { formatDate, formatDistance, formatDuration, formatPace } from "../lib";

type StreamSeries = {
  distance: number[];
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
  points: ChartPoint[];
  linePath: string;
  areaPath: string;
  yTicks: number[];
  xTicks: number[];
  yLabel: string;
  xLabel: string;
  summaryLeft: string;
  summaryLeftLabel: string;
  summaryRight: string;
  summaryRightLabel: string;
};

const CHART_WIDTH = 620;
const CHART_HEIGHT = 230;
const Y_TICK_COUNT = 4;
const X_TICK_COUNT = 5;

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

function buildChartPaths(
  points: ChartPoint[],
  minY: number,
  maxY: number,
  invertY: boolean
) {
  if (points.length < 2) {
    return { linePath: "", areaPath: "" };
  }

  const maxX = points[points.length - 1].x || 1;
  const yRange = maxY - minY || 1;

  const project = (point: ChartPoint) => {
    const x = (point.x / maxX) * CHART_WIDTH;
    const ratio = clamp((point.y - minY) / yRange, 0, 1);
    const normalized = invertY ? ratio : 1 - ratio;
    const y = normalized * CHART_HEIGHT;
    return { x, y };
  };

  const projected = points.map(project);
  const linePath = projected
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");

  const first = projected[0];
  const last = projected[projected.length - 1];
  const areaPath = `${linePath} L ${last.x.toFixed(2)} ${CHART_HEIGHT} L ${first.x.toFixed(2)} ${CHART_HEIGHT} Z`;

  return { linePath, areaPath };
}

function buildTicks(min: number, max: number, count: number) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return [];
  }

  if (min === max) {
    return [min];
  }

  return Array.from({ length: count + 1 }, (_, index) => min + ((max - min) * index) / count);
}

function buildDistanceTicks(maxDistanceMeters: number) {
  if (!Number.isFinite(maxDistanceMeters) || maxDistanceMeters <= 0) {
    return [];
  }

  return Array.from({ length: X_TICK_COUNT }, (_, index) => (maxDistanceMeters * index) / (X_TICK_COUNT - 1));
}

function preparePaceChart(streams: StreamSeries, workout: WorkoutData["workout"] | null): ChartModel | null {
  if (!streams?.distance?.length || !streams?.velocity_smooth?.length) {
    return null;
  }

  const size = Math.min(streams.distance.length, streams.velocity_smooth.length);
  const validPaces: number[] = [];
  const rawPoints: ChartPoint[] = [];

  for (let index = 0; index < size; index += 1) {
    const distance = streams.distance[index];
    const speed = streams.velocity_smooth[index];
    if (!Number.isFinite(distance) || distance < 0) {
      continue;
    }

    let paceSeconds: number | null = null;
    if (Number.isFinite(speed) && speed > 0) {
      const candidate = 1000 / speed;
      if (candidate >= 150 && candidate <= 900) {
        paceSeconds = candidate;
        validPaces.push(candidate);
      }
    }

    rawPoints.push({
      x: distance,
      y: paceSeconds ?? Number.NaN
    });
  }

  if (rawPoints.length < 2 || validPaces.length < 2) {
    return null;
  }

  const averagePace = workout?.average_speed ? 1000 / workout.average_speed : quantile(validPaces, 0.5);
  const bestPace = Math.min(...validPaces);
  const fastBound = clamp(Math.floor((quantile(validPaces, 0.05) - 20) / 10) * 10, 150, averagePace);
  const slowBound = clamp(Math.ceil((quantile(validPaces, 0.95) + 30) / 10) * 10, averagePace + 30, 900);

  const points = rawPoints.map((point) => ({
    x: point.x,
    y: Number.isFinite(point.y) ? clamp(point.y, fastBound, slowBound) : slowBound
  }));

  const { linePath, areaPath } = buildChartPaths(points, fastBound, slowBound, true);

  return {
    points,
    linePath,
    areaPath,
    yTicks: buildTicks(fastBound, slowBound, Y_TICK_COUNT),
    xTicks: buildDistanceTicks(points[points.length - 1].x),
    yLabel: "Темп",
    xLabel: "Дистанция (км)",
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

  const size = Math.min(streams.distance.length, streams.heartrate.length);
  const points: ChartPoint[] = [];
  const validHr: number[] = [];

  for (let index = 0; index < size; index += 1) {
    const distance = streams.distance[index];
    const hr = streams.heartrate[index];
    if (!Number.isFinite(distance) || distance < 0 || !Number.isFinite(hr) || hr <= 0) {
      continue;
    }

    points.push({ x: distance, y: hr });
    validHr.push(hr);
  }

  if (points.length < 2 || validHr.length < 2) {
    return null;
  }

  const minHr = Math.max(60, Math.floor((Math.min(...validHr) - 8) / 5) * 5);
  const maxHr = Math.ceil((Math.max(...validHr) + 8) / 5) * 5;
  const { linePath, areaPath } = buildChartPaths(points, minHr, maxHr, false);

  return {
    points,
    linePath,
    areaPath,
    yTicks: buildTicks(minHr, maxHr, Y_TICK_COUNT),
    xTicks: buildDistanceTicks(points[points.length - 1].x),
    yLabel: "Пульс",
    xLabel: "Дистанция (км)",
    summaryLeft: formatHeartRate(workout?.average_heartrate),
    summaryLeftLabel: "Средний",
    summaryRight: formatHeartRate(workout?.max_heartrate ?? Math.max(...validHr)),
    summaryRightLabel: "Максимум"
  };
}

function xTickLabel(value: number) {
  return `${(value / 1000).toFixed(1)}`;
}

function StreamChart({
  title,
  color,
  fill,
  model,
  formatter
}: {
  title: string;
  color: string;
  fill: string;
  model: ChartModel | null;
  formatter: (value: number) => string;
}) {
  if (!model || !model.linePath) {
    return (
      <div className="chart-card">
        <div className="chart-header">
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
        <div className="chart-y-label">{model.yLabel}</div>
        <div className="chart-grid-wrap">
          <div className="chart-y-axis">
            {model.yTicks.map((tick) => (
              <span key={tick}>{formatter(tick)}</span>
            ))}
          </div>
          <div className="chart-grid">
            {model.yTicks.map((tick) => (
              <div key={tick} className="chart-grid-line" />
            ))}
            <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="chart-svg" preserveAspectRatio="none">
              <path d={model.areaPath} fill={fill} />
              <path d={model.linePath} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
          </div>
        </div>
      </div>
      <div className="chart-x-axis">
        {model.xTicks.map((tick) => (
          <span key={tick}>{xTickLabel(tick)}</span>
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
                <span>Дистанция</span>
                <span>Темп</span>
                <span>Пульс</span>
              </div>
              {data.laps.map((lap, index) => (
                <div key={lap.id} className="compact-lap-row">
                  <span className="lap-name">{lap.name || `Lap ${index + 1}`}</span>
                  <span>{formatDistance(lap.distance_meters)}</span>
                  <span>{formatPace(lap.average_speed)}</span>
                  <span>{lap.average_heartrate ? `${Math.round(lap.average_heartrate)}` : "—"}</span>
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
            color="#2f7de1"
            fill="rgba(47, 125, 225, 0.30)"
            formatter={formatPaceSeconds}
          />
          <StreamChart
            title="Пульс"
            model={heartRateChart}
            color="#d63b3b"
            fill="rgba(214, 59, 59, 0.25)"
            formatter={(value) => `${Math.round(value)}`}
          />
        </div>
      </section>
    </div>
  );
}
