import { Link, useParams } from "react-router-dom";
import { useState, useEffect } from "react";

import { api } from "../api";
import { formatDate, formatDistance, formatDuration, formatPace } from "../lib";
import { useApi } from "../hooks/useApi";

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
  const { data, loading, error } = useApi<AthletePageData>(`/api/trainer/athletes/${params.id}`);

  const [extraWorkouts, setExtraWorkouts] = useState<AthletePageData['workouts']>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    if (data) {
      setExtraWorkouts([]);
      setHasMore(data.workouts.length === 20);
    }
  }, [data]);

  async function loadMore() {
    const currentWorkouts = [...(data?.workouts || []), ...extraWorkouts];
    const last = currentWorkouts[currentWorkouts.length - 1];
    if (!last) return;
    
    setIsLoadingMore(true);
    try {
      const moreData = await api<AthletePageData>(`/api/trainer/athletes/${params.id}?before=${last.start_date}`);
      if (moreData.workouts.length < 20) {
        setHasMore(false);
      }
      setExtraWorkouts(prev => [...prev, ...moreData.workouts]);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingMore(false);
    }
  }

  if (loading) {
    return (
      <div className="card skeleton-card">
        <h2>Загрузка профиля спортсмена...</h2>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="card">
        <h2>Ошибка</h2>
        <p className="muted">{error || "Спортсмен не найден"}</p>
        <Link to="/trainer" className="button primary-button">Назад</Link>
      </div>
    );
  }

  const allWorkouts = [...data.workouts, ...extraWorkouts];

  return (
    <div className="card">
      <Link to="/trainer" className="inline-link">Назад</Link>
      <h2>{data.athlete.full_name}</h2>
      <p className="muted">@{data.athlete.username}</p>
      
      <h3>Все пробежки</h3>
      <div className="list">
        {allWorkouts.length === 0 && <div className="muted">Пока нет тренировок.</div>}
        {allWorkouts.map((workout) => (
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
      {allWorkouts.length > 0 && hasMore && (
         <div style={{ marginTop: "16px", textAlign: "center" }}>
           <button className="ghost-button" disabled={isLoadingMore} onClick={loadMore}>
             {isLoadingMore ? "Загрузка..." : "Загрузить ещё"}
           </button>
         </div>
      )}
    </div>
  );
}
