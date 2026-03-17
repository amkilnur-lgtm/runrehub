import { useEffect, useState } from "react";
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

function buildPath(values: number[], width: number, height: number) {
  if (values.length < 2) {
    return "";
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function paceSeries(values: number[]) {
  return values.filter((value) => value > 0).map((value) => 1000 / value / 60);
}

function heartRateSeries(values: number[]) {
  return values.filter((value) => value > 0);
}

function paceLabel(value: number) {
  const minutes = Math.floor(value);
  const seconds = Math.round((value - minutes) * 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}/км`;
}

function hrLabel(value: number) {
  return `${Math.round(value)} уд/мин`;
}

function rangeLabel(values: number[], formatter: (value: number) => string) {
  if (!values.length) {
    return "Нет данных";
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  return `${formatter(min)} - ${formatter(max)}`;
}

function StreamChart({
  title,
  values,
  color,
  formatter
}: {
  title: string;
  values: number[];
  color: string;
  formatter: (value: number) => string;
}) {
  const path = buildPath(values, 520, 160);

  return (
    <div className="chart-card">
      <div className="chart-header">
        <strong>{title}</strong>
        <span className="muted">{rangeLabel(values, formatter)}</span>
      </div>
      {path ? (
        <svg viewBox="0 0 520 160" className="chart-svg" preserveAspectRatio="none">
          <path d={path} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" />
        </svg>
      ) : (
        <div className="chart-empty muted">Нет данных Strava для этого графика.</div>
      )}
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

  const paceValues = paceSeries(data?.streams?.velocity_smooth ?? []);
  const hrValues = heartRateSeries(data?.streams?.heartrate ?? []);

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
            <div className="stat-value">
              {data?.workout.average_heartrate ? `${Math.round(data.workout.average_heartrate)} уд/мин` : "—"}
            </div>
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
          <StreamChart title="Темп" values={paceValues} color="#dd6b20" formatter={paceLabel} />
          <StreamChart title="Пульс" values={hrValues} color="#c53030" formatter={hrLabel} />
        </div>
      </section>
    </div>
  );
}
