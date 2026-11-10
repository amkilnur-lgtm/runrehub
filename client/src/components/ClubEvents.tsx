import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useApi } from "../hooks/useApi";
import { UserAvatar } from "./UserAvatar";

// «В клубе» внизу главной: 2–3 поддерживающих события, без чужих темпа и пульса.
// Нет событий — нет блока. «Скрыть» запоминается на этом устройстве.
type ClubEvent = {
  kind: "birthday" | "record" | "return";
  athlete_id: number;
  full_name: string;
  avatar_url: string | null;
  text: string;
  sub: string;
  workout_id: number | null;
};

const HIDE_KEY = "rr-home-club-hidden";

function readHidden() {
  try {
    return localStorage.getItem(HIDE_KEY) === "1";
  } catch {
    return false;
  }
}

export function ClubEvents() {
  const [hidden, setHidden] = useState(readHidden);
  const { data } = useApi<{ events: ClubEvent[] }>(hidden ? null : "/api/athlete/club-events");
  const navigate = useNavigate();
  if (hidden || !data?.events.length) return null;

  const open = (event: ClubEvent) => {
    if (event.kind === "birthday" && event.workout_id) {
      navigate(`/athlete/workouts/${event.workout_id}?say=${encodeURIComponent("С днём рождения! 🎉")}`);
    } else if (event.kind === "record" && event.workout_id) {
      navigate(`/athlete/workouts/${event.workout_id}?say=${encodeURIComponent("Поздравляю с рекордом! 🎉")}`);
    } else {
      navigate(`/athlete/athletes/${event.athlete_id}`);
    }
  };

  return (
    <div>
      <div className="ds-grp">
        <span>В клубе</span>
        <button
          type="button"
          className="ds-link club-ev-hide"
          onClick={() => {
            try {
              localStorage.setItem(HIDE_KEY, "1");
            } catch {
              /* приватный режим — просто скрываем до перезагрузки */
            }
            setHidden(true);
          }}
        >
          скрыть
        </button>
      </div>
      <div className="ds-list">
        {data.events.map((event) => (
          <button key={`${event.kind}-${event.athlete_id}`} type="button" className="ds-li club-ev" onClick={() => open(event)}>
            <UserAvatar fullName={event.full_name} avatarUrl={event.avatar_url} className="club-av" />
            <div className="ds-m">
              <b>{event.text}</b>
              <span>{event.sub}</span>
            </div>
          </button>
        ))}
        <Link to="/athlete/feed" className="ds-li mate-more">
          Вся лента ›
        </Link>
      </div>
    </div>
  );
}
