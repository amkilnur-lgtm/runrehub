import { Link, useNavigate, useParams } from "react-router-dom";

import { formatRaceTime } from "../components/Results";
import { UserAvatar } from "../components/UserAvatar";
import { useApi } from "../hooks/useApi";
import { formatKm, formatPace, pluralRu } from "../lib";
import { getTelegramWebApp, isTelegramMiniApp } from "../telegram";

// Страница одногруппника (утверждённый макет): кто это → одна кнопка по моменту →
// 4 недели → 12 недель → ближайший старт → рекорды → последние пробежки.
// Только то, что видно группе: самочувствие, комментарии тренера, форма и зоны — у тренера.

type Best = {
  distanceMeters: number;
  label: string;
  result: {
    id: number;
    race_date: string;
    name: string;
    official_time_seconds: number | null;
  } | null;
  improvementSeconds: number | null;
};

type TeammateProfile = {
  athlete: {
    id: number;
    full_name: string;
    avatar_url: string | null;
    coach_name: string | null;
    member_since: string;
    telegram_username: string | null;
  };
  last4: { distance_meters: number; runs: number; weeks_with_runs: number };
  weekStarts: string[];
  weeklyDistances: number[];
  last_run_at: string | null;
  paused: boolean;
  nextStart: {
    id: number;
    name: string;
    race_date: string;
    distance_meters: number;
    days: number;
    viewer_too: boolean;
  } | null;
  personalBests: Best[];
  freshBestDistance: number | null;
  recent: {
    id: number;
    name: string;
    start_date: string;
    distance_meters: number;
    average_speed: number | null;
    average_heartrate: number | null;
  }[];
  moment: {
    kind: "record" | "luck" | "support" | "welcome";
    workoutId: number | null;
  } | null;
};

const MONTHS = [
  "янв",
  "фев",
  "мар",
  "апр",
  "мая",
  "июн",
  "июл",
  "авг",
  "сен",
  "окт",
  "ноя",
  "дек",
];
const MONTHS_FULL = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];
const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

const MOMENT_COPY = {
  record: { label: "Поздравить с рекордом", text: "Поздравляю с рекордом! 🎉" },
  luck: { label: "Пожелать удачи", text: "Удачи на старте! 💪" },
  support: { label: "Поддержать", text: "Ждём тебя на пробежках! 💙" },
  welcome: {
    label: "Поприветствовать",
    text: "Привет! Рады видеть тебя в клубе 👋",
  },
} as const;

function firstName(fullName: string) {
  return fullName.split(" ")[0] ?? fullName;
}

function memberSince(value: string) {
  const date = new Date(value);
  if (Date.now() - date.getTime() < 7 * 86_400_000)
    return "в клубе с этой недели";
  const year =
    date.getFullYear() === new Date().getFullYear()
      ? ""
      : ` ${date.getFullYear()}`;
  return `в клубе с ${MONTHS_FULL[date.getMonth()]}${year}`;
}

function runDate(value: string) {
  const date = new Date(value);
  const today = new Date();
  const days = Math.floor(
    (new Date(today.toDateString()).getTime() -
      new Date(date.toDateString()).getTime()) /
      86_400_000,
  );
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  if (days === 0) return `сегодня, ${time}`;
  if (days === 1) return `вчера, ${time}`;
  if (days < 7)
    return `${WEEKDAYS[date.getDay()]}, ${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

function openTelegram(username: string) {
  const url = `https://t.me/${username.replace(/^@/, "")}`;
  const webApp = getTelegramWebApp() as unknown as {
    openTelegramLink?: (url: string) => void;
  } | null;
  if (webApp?.openTelegramLink) webApp.openTelegramLink(url);
  else window.open(url, "_blank", "noopener");
}

export function AthleteProfilePage() {
  const params = useParams();
  const navigate = useNavigate();
  const { data, error } = useApi<TeammateProfile>(
    `/api/athlete/athletes/${params.id}/profile`,
  );

  if (error)
    return (
      <div className="ds-screen">
        <p className="ds-empty">{error}</p>
      </div>
    );
  if (!data)
    return (
      <div className="ds-screen" aria-busy="true">
        <div className="mate-skel" />
      </div>
    );

  const { athlete, last4, recent, moment } = data;
  const name = firstName(athlete.full_name);
  const hasRuns = recent.length > 0;
  const weeks = data.weeklyDistances;
  const max = Math.max(...weeks, 1);
  const firstWeek = data.weekStarts[0] ? new Date(data.weekStarts[0]) : null;
  const sub = [
    athlete.coach_name ? `тренер ${firstName(athlete.coach_name)}` : null,
    memberSince(athlete.member_since),
  ]
    .filter(Boolean)
    .join(" · ");
  const lastRun = data.last_run_at ? new Date(data.last_run_at) : null;

  const primary =
    moment && moment.workoutId
      ? {
          label: MOMENT_COPY[moment.kind].label,
          onClick: () =>
            navigate(
              `/athlete/workouts/${moment.workoutId}?say=${encodeURIComponent(MOMENT_COPY[moment.kind].text)}`,
            ),
        }
      : null;
  const telegram = athlete.telegram_username;

  return (
    <div className="ds-screen mate">
      {isTelegramMiniApp ? null : (
        <Link
          to="/athlete/feed"
          className="ds-link"
          onClick={(event) => {
            if (
              ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0
            ) {
              event.preventDefault();
              navigate(-1);
            }
          }}
        >
          ‹ Назад
        </Link>
      )}
      <header className="mate-head">
        <UserAvatar
          fullName={athlete.full_name}
          avatarUrl={athlete.avatar_url}
          className="mate-av"
        />
        <div>
          <h1>{athlete.full_name}</h1>
          <span>{sub}</span>
        </div>
      </header>

      {primary || telegram ? (
        <div className="mate-act">
          {primary ? (
            <button
              type="button"
              className="ds-btn ds-btn-1"
              onClick={primary.onClick}
            >
              {primary.label}
            </button>
          ) : null}
          {telegram ? (
            primary ? (
              <button
                type="button"
                className="ds-btn ds-btn-3"
                onClick={() => openTelegram(telegram)}
              >
                Написать
              </button>
            ) : (
              <button
                type="button"
                className="ds-btn ds-btn-1"
                onClick={() => openTelegram(telegram)}
              >
                Написать в Telegram
              </button>
            )
          ) : null}
        </div>
      ) : null}

      {!hasRuns ? (
        <section className="ds-block ds-pad mate-empty">
          <b>Пробежек пока нет</b>
          <p>
            Когда {name} подключит часы или intervals.icu, здесь появятся
            пробежки, километраж и рекорды.
          </p>
        </section>
      ) : (
        <section
          className="ds-block ds-pad mate-vol"
          aria-label="Последние 4 недели"
        >
          <b className="mate-bt">Последние 4 недели</b>
          {data.paused && lastRun ? (
            <p className="mate-pause">
              Пауза в беге. Последняя пробежка — {lastRun.getDate()}{" "}
              {MONTHS_FULL[lastRun.getMonth()]}.
            </p>
          ) : (
            <div className="workout-stats-row mate-three">
              <div>
                <span>км</span>
                <b>{formatKm(last4.distance_meters)}</b>
              </div>
              <div>
                <span>
                  {pluralRu(last4.runs, "пробежка", "пробежки", "пробежек")}
                </span>
                <b>{last4.runs}</b>
              </div>
              <div>
                <span>недель</span>
                <b>
                  {last4.weeks_with_runs}
                  <small> из 4</small>
                </b>
              </div>
            </div>
          )}
          {weeks.some((meters) => meters > 0) ? (
            <>
              <div
                className="runs-vol"
                role="img"
                aria-label={`Километраж за ${weeks.length} недель: ${weeks.map((meters) => formatKm(meters)).join(", ")} км`}
              >
                {weeks.map((meters, index) => (
                  <i
                    key={data.weekStarts[index] ?? index}
                    className={
                      index === weeks.length - 1 ? "is-current" : undefined
                    }
                    style={{
                      height: `${meters ? Math.max((meters / max) * 100, 4) : 0}%`,
                    }}
                    title={`${formatKm(meters)} км`}
                  />
                ))}
              </div>
              <div className="runs-vax">
                <span>
                  {firstWeek
                    ? `${firstWeek.getDate()} ${MONTHS[firstWeek.getMonth()]}`
                    : ""}
                </span>
                <span>эта неделя</span>
              </div>
            </>
          ) : null}
        </section>
      )}

      {data.nextStart ? (
        <section className="ds-block ds-pad" aria-label="Ближайший старт">
          <b className="mate-bt">Ближайший старт</b>
          <div className="mate-race">
            <div className="mate-race-d">
              <b>{new Date(data.nextStart.race_date).getDate()}</b>
              <span>
                {MONTHS[new Date(data.nextStart.race_date).getMonth()]}
              </span>
            </div>
            <div className="mate-race-m">
              <b>{data.nextStart.name}</b>
              <span>
                {formatKm(data.nextStart.distance_meters, 1)} км ·{" "}
                {data.nextStart.days === 0
                  ? "сегодня"
                  : `через ${data.nextStart.days} ${pluralRu(data.nextStart.days, "день", "дня", "дней")}`}
              </span>
            </div>
            {data.nextStart.viewer_too ? (
              <span className="ds-pill ds-pill-accent">вы тоже</span>
            ) : null}
          </div>
        </section>
      ) : null}

      {data.personalBests.some((best) => best.result) ? (
        <section className="ds-block ds-pad" aria-label="Личные рекорды">
          <b className="mate-bt">Личные рекорды</b>
          <div className="mate-pb">
            {data.personalBests.map((best) => {
              const fresh =
                best.result && best.distanceMeters === data.freshBestDistance;
              return (
                <div
                  key={best.distanceMeters}
                  className={
                    fresh ? "is-fresh" : best.result ? undefined : "is-empty"
                  }
                >
                  <span>{best.label}</span>
                  <b>
                    {best.result
                      ? formatRaceTime(best.result.official_time_seconds)
                      : "ещё нет"}
                  </b>
                  {fresh ? (
                    <small>
                      {best.improvementSeconds
                        ? `−${formatRaceTime(best.improvementSeconds)}`
                        : "новый"}{" "}
                      · {new Date(best.result!.race_date).getDate()}{" "}
                      {MONTHS[new Date(best.result!.race_date).getMonth()]}
                    </small>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {hasRuns ? (
        <div>
          <div className="ds-list">
            <b className="mate-lh">Пробежки</b>
            {recent.map((run) => (
              <Link
                key={run.id}
                to={`/athlete/workouts/${run.id}`}
                className="ds-li"
              >
                <div className="ds-m">
                  <b>{run.name || "Пробежка"}</b>
                  <span>{runDate(run.start_date)}</span>
                </div>
                <div className="mate-v">
                  <b>
                    {formatKm(run.distance_meters, 2)}
                    <small> км</small>
                  </b>
                  <span>
                    {formatPace(run.average_speed).replace("/км", "").trim()}
                    {run.average_heartrate
                      ? ` · ${Math.round(run.average_heartrate)} уд/мин`
                      : ""}
                  </span>
                </div>
              </Link>
            ))}
            <Link
              to={`/athlete/athletes/${athlete.id}/runs`}
              className="ds-li mate-more"
            >
              Все пробежки ›
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
