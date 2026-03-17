import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { api } from "../api";
import { formatDate, formatDistance, formatDuration, formatPace } from "../lib";

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
};

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
        <div className="grid three-columns">
          <div className="card inset-card">
            <div className="muted">Дистанция</div>
            <div className="stat-value">{data ? formatDistance(data.workout.distance_meters) : "—"}</div>
          </div>
          <div className="card inset-card">
            <div className="muted">Время</div>
            <div className="stat-value">{data ? formatDuration(data.workout.moving_time_seconds) : "—"}</div>
          </div>
          <div className="card inset-card">
            <div className="muted">Темп</div>
            <div className="stat-value">{data ? formatPace(data.workout.average_speed) : "—"}</div>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Отрезки</h2>
        <div className="list">
          {data?.laps.length ? (
            data.laps.map((lap, index) => (
              <div key={lap.id} className="list-row">
                <div>
                  <strong>{lap.name || `Отрезок ${index + 1}`}</strong>
                  <div className="muted">{formatDistance(lap.distance_meters)}</div>
                </div>
                <div className="align-right">
                  <div>{formatDuration(lap.elapsed_time_seconds)}</div>
                  <div className="muted">
                    {formatPace(lap.average_speed)} · {lap.average_heartrate ? `${Math.round(lap.average_heartrate)} уд/мин` : "пульс —"}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="muted">Strava не вернула отдельные отрезки для этой тренировки.</div>
          )}
        </div>
      </section>
    </div>
  );
}
