import { Link } from "react-router-dom";

import { formatGoalTime, formatRaceTime } from "../components/Results";
import { UserAvatar } from "../components/UserAvatar";
import { useApi } from "../hooks/useApi";
import { pluralRu } from "../lib";

// «Старты» тренера: старты группы по датам — эта неделя сверху, потом позже, потом прошедшие
type Start = {
  id: number;
  user_id: number;
  name: string;
  race_date: string;
  distance_meters: number;
  goal_time_seconds: number | null;
  official_time_seconds?: number | null;
  city: string | null;
  athlete_name: string;
  athlete_avatar_url: string | null;
};

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

function day(iso: string) {
  const [year, month, date] = iso.slice(0, 10).split("-").map(Number);
  const value = new Date(year!, month! - 1, date!);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return { value, daysLeft: Math.round((value.getTime() - today.getTime()) / 86_400_000), label: `${WEEKDAYS[value.getDay()]}, ${date} ${MONTHS[month! - 1]}` };
}

function distanceLabel(meters: number) {
  const known: Record<number, string> = { 5000: "5 км", 10000: "10 км", 21097: "21,1 км", 42195: "42,2 км" };
  const hit = Object.keys(known).map(Number).find((value) => Math.abs(value - meters) / value <= 0.02);
  return hit ? known[hit]! : `${(meters / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} км`;
}

function StartRow({ start, past }: { start: Start; past?: boolean }) {
  const when = day(start.race_date);
  return (
    <Link className="ds-li" to={`/trainer/athletes/${start.user_id}`}>
      {past ? (
        <UserAvatar fullName={start.athlete_name} avatarUrl={start.athlete_avatar_url} className="avatar-sm" />
      ) : (
        <div className="st-cd">
          <b>{when.daysLeft}</b>
          <span>{when.daysLeft === 0 ? "сегодня" : pluralRu(when.daysLeft, "день", "дня", "дней")}</span>
        </div>
      )}
      <div className="ds-m">
        <b>
          {start.athlete_name.split(" ")[0]} · {start.name}
        </b>
        <span>
          {when.label} · {distanceLabel(start.distance_meters)}
          {start.city ? ` · ${start.city}` : ""}
        </span>
      </div>
      {past ? (
        <div className="ds-v">{formatRaceTime(start.official_time_seconds ?? null)}</div>
      ) : start.goal_time_seconds ? (
        <span className="ds-pill ds-pill-soft">цель {formatGoalTime(start.goal_time_seconds)}</span>
      ) : null}
    </Link>
  );
}

export function TrainerStartsPage() {
  const { data, loading, error } = useApi<{ upcoming: Start[]; recent: Start[] }>("/api/trainer/starts");

  if (loading && !data) {
    return (
      <div className="ds-screen">
        <div className="skeleton-block" style={{ height: 32, width: 160 }} />
        <div className="skeleton-block" style={{ height: 240, borderRadius: 16 }} />
      </div>
    );
  }
  if (error || !data) {
    return (
      <section className="ds-block ds-pad">
        <p className="ds-sub">{error || "Не удалось загрузить старты"}</p>
      </section>
    );
  }

  const thisWeek = data.upcoming.filter((start) => day(start.race_date).daysLeft < 7);
  const later = data.upcoming.filter((start) => day(start.race_date).daysLeft >= 7);

  return (
    <div className="ds-screen" style={{ gap: 20 }}>
      <div>
        <h1 className="ds-title">Старты</h1>
        <p className="ds-sub">Старты группы. Старты и результаты добавляют сами спортсмены.</p>
      </div>
      {[
        { title: "На этой неделе", rows: thisWeek },
        { title: "Позже", rows: later }
      ].map((group) =>
        group.rows.length ? (
          <div key={group.title}>
            <div className="ds-grp">
              <span>{group.title}</span>
            </div>
            <div className="ds-list">
              {group.rows.map((start) => (
                <StartRow key={start.id} start={start} />
              ))}
            </div>
          </div>
        ) : null
      )}
      {!data.upcoming.length ? (
        <section className="ds-block ds-pad">
          <p className="ds-sub" style={{ margin: 0 }}>
            Запланированных стартов нет.
          </p>
        </section>
      ) : null}
      {data.recent.length ? (
        <div>
          <div className="ds-grp">
            <span>Прошедшие</span>
            <span>4 месяца</span>
          </div>
          <div className="ds-list">
            {data.recent.map((start) => (
              <StartRow key={start.id} start={start} past />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
