import { Link } from "react-router-dom";

import { UserAvatar } from "../components/UserAvatar";
import { formatDate, formatDistance, formatDuration, formatPace } from "../lib";
import { useApi } from "../hooks/useApi";

type DashboardData = {
  athletes: Array<{
    id: number;
    full_name: string;
    username: string;
    avatar_url: string | null;
    last_workout_at: string | null;
  }>;
  recentWorkouts: Array<{
    id: number;
    user_id: number;
    athlete_name: string;
    name: string;
    start_date: string;
    distance_meters: number;
    moving_time_seconds: number;
    average_speed: number | null;
  }>;
};

export function TrainerDashboardPage() {
  const { data, loading, error } = useApi<DashboardData>("/api/trainer/dashboard");

  if (loading) {
    return (
      <div className="grid two-columns">
        <section className="card skeleton-card">
          <h2>Спортсмены</h2>
          <p className="muted">Загрузка...</p>
        </section>
        <section className="card skeleton-card">
          <h2>Последние пробежки</h2>
          <p className="muted">Загрузка...</p>
        </section>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="card">
        <h2>Ошибка</h2>
        <p className="muted">{error || "Не удалось загрузить данные"}</p>
      </div>
    );
  }

  return (
    <div className="grid two-columns">
      <section className="card">
        <h2>Спортсмены</h2>
        <div className="list">
          {data.athletes.map((athlete) => (
            <Link key={athlete.id} className="list-row link-row" to={`/trainer/athletes/${athlete.id}`}>
              <div className="athlete-list-main">
                <UserAvatar
                  fullName={athlete.full_name}
                  avatarUrl={athlete.avatar_url}
                  className="athlete-list-avatar"
                  ariaHidden
                />
                <div className="athlete-list-text">
                  <strong>{athlete.full_name}</strong>
                  <div className="muted">@{athlete.username}</div>
                </div>
              </div>
              <div className="muted">
                {athlete.last_workout_at ? formatDate(athlete.last_workout_at) : "Без пробежек"}
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Последние пробежки</h2>
        <div className="list">
          {data.recentWorkouts.map((workout) => (
            <Link
              key={workout.id}
              className="list-row link-row compact-workout-row"
              to={`/trainer/workouts/${workout.id}`}
            >
              <div className="compact-workout-main">
                <strong>{workout.athlete_name}</strong>
                <div>{workout.name}</div>
                <div className="muted">{formatDate(workout.start_date)}</div>
              </div>
              <div className="align-right compact-workout-meta">
                <div>{formatDistance(workout.distance_meters)}</div>
                <div className="muted">
                  {formatDuration(workout.moving_time_seconds)} · {formatPace(workout.average_speed)}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
