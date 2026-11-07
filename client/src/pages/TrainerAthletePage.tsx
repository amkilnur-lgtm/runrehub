import { useParams } from "react-router-dom";

import { AthleteProfileView } from "../components/AthleteProfileView";

export function TrainerAthletePage() {
  const params = useParams();
  const athleteId = Number(params.id);

  return (
    <AthleteProfileView
      key={params.id}
      endpoint={`/api/trainer/athletes/${params.id}`}
      backTo="/trainer"
      backLabel="К обзору группы"
      workoutHref={(id) => `/trainer/workouts/${id}`}
      trends={{ athleteId }}
      emptyHint={(connected) =>
        connected
          ? "Пробежки появятся после следующей синхронизации с часами спортсмена."
          : "У спортсмена не подключена синхронизация — попросите администратора настроить intervals.icu."
      }
    />
  );
}
