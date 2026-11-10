import { useParams } from "react-router-dom";

import { AthleteProfileView } from "../components/AthleteProfileView";

// «Все пробежки» одногруппника — полный список с картами, вход со страницы одногруппника
export function AthleteProfileRunsPage() {
  const params = useParams();
  return (
    <AthleteProfileView
      key={params.id}
      viewer="teammate"
      endpoint={`/api/athlete/athletes/${params.id}`}
      backTo={`/athlete/athletes/${params.id}`}
      backLabel="Профиль"
      workoutHref={(id) => `/athlete/workouts/${id}`}
      trends={{ trendsEndpoint: `/api/athlete/athletes/${params.id}/trends` }}
      emptyHint={() => "Пока нет пробежек."}
    />
  );
}
