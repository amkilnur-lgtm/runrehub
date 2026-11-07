import { useParams } from "react-router-dom";

import { AthleteProfileView } from "../components/AthleteProfileView";

// Страница одногруппника: провал из ленты по аватару/имени. Только чтение.
export function AthleteProfilePage() {
  const params = useParams();

  return (
    <AthleteProfileView
      key={params.id}
      endpoint={`/api/athlete/athletes/${params.id}`}
      backTo="/athlete"
      backLabel="На главную"
      workoutHref={(id) => `/athlete/workouts/${id}`}
      trends={{ trendsEndpoint: `/api/athlete/athletes/${params.id}/trends` }}
      emptyHint={() => "Пока нет пробежек."}
    />
  );
}
