import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { api } from "../api";
import { formatDate, formatDistance, formatDuration, formatPace } from "../lib";

type AthletePageData = {
  athlete: {
    id: number;
    full_name: string;
    username: string;
  };
  workouts: Array<{
    id: number;
    name: string;
    start_date: string;
    distance_meters: number;
    moving_time_seconds: number;
    average_speed: number | null;
  }>;
};

export function TrainerAthletePage() {
  const params = useParams();
  const [data, setData] = useState<AthletePageData | null>(null);

  useEffect(() => {
    void api<AthletePageData>(`/api/trainer/athletes/${params.id}`).then(setData);
  }, [params.id]);

  return (
    <div className="card">
      <h2>{data?.athlete.full_name}</h2>
      <p className="muted">@{data?.athlete.username}</p>
      <div className="list">
        {data?.workouts.map((workout) => (
          <Link key={workout.id} className="list-row link-row" to={`/trainer/workouts/${workout.id}`}>
            <div>
              <strong>{workout.name}</strong>
              <div className="muted">{formatDate(workout.start_date)}</div>
            </div>
            <div className="align-right">
              <div>{formatDistance(workout.distance_meters)}</div>
              <div className="muted">
                {formatDuration(workout.moving_time_seconds)} · {formatPace(workout.average_speed)}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
