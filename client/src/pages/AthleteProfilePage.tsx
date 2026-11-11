import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { PbGrid } from "../components/PbGrid";
import { formatRaceTime } from "../components/Results";
import { UserAvatar } from "../components/UserAvatar";
import { useApi } from "../hooks/useApi";
import { formatKm, formatPace, pluralRu } from "../lib";
import { congratulate } from "../lib-congrats";
import { useToast } from "../components/ToastProvider";
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
  about: string | null;
  rank_label: string | null;
  achievements: { id: number; title: string; year: number | null }[];
  recovering: boolean;
  birthday: string | null;
  upcoming: {
    id: number;
    name: string;
    race_date: string;
    distance_meters: number;
    goal_time_seconds: number | null;
    viewer_too: boolean;
  }[];
  past: {
    id: number;
    name: string;
    race_date: string;
    distance_meters: number;
    official_time_seconds: number | null;
    place_overall: number | null;
    participants: number | null;
    is_record: boolean;
  }[];
  finished_count: number;
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

function shortDate(value: string) {
  const date = new Date(value);
  const year =
    date.getFullYear() === new Date().getFullYear()
      ? ""
      : ` ${date.getFullYear()}`;
  return `${date.getDate()} ${MONTHS[date.getMonth()]}${year}`;
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
  const showToast = useToast();
  const [congratulated, setCongratulated] = useState(false);
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

  // «Поздравить / Пожелать удачи» — лайк его последней пробежки: общаемся в чате группы в Telegram
  const primary =
    moment && moment.workoutId
      ? {
          label: congratulated ? "Отправили ✓" : MOMENT_COPY[moment.kind].label,
          onClick: async () => {
            if (congratulated) return;
            try {
              await congratulate(moment.workoutId!);
              setCongratulated(true);
              showToast("success", `${name} увидит лайк на последней пробежке`);
            } catch (error) {
              showToast(
                "error",
                error instanceof Error ? error.message : "Не получилось",
              );
            }
          },
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
      {/* всё про человека — одной карточкой: фото, имя с разрядом, «в клубе с …», о себе, ниже мелко ДР и достижения */}
      <section className="ds-block mate-card" aria-label="О спортсмене">
        <header className="mate-head">
          <UserAvatar
            fullName={athlete.full_name}
            avatarUrl={athlete.avatar_url}
            className="mate-av"
          />
          <div>
            <h1>
              {athlete.full_name}
              {data.rank_label ? (
                <span className="mate-rank">{data.rank_label}</span>
              ) : null}
            </h1>
            <span>
              {data.recovering ? "отдых · " : ""}
              {memberSince(athlete.member_since)}
            </span>
          </div>
        </header>
        {data.about ? <p className="mate-about">{data.about}</p> : null}
        {data.birthday || data.achievements.length ? (
          <div className="mate-facts2">
            {data.birthday ? (
              <div className="mate-fact">
                <span className="mate-fi" aria-hidden="true">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M4 21h16M5 21v-7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7M5 16c1.5 1 3 1 4.5 0s3-1 4.5 0 3 1 5 0M12 12V8M12 5.5c.8-.8.8-1.7 0-2.5-.8.8-.8 1.7 0 2.5z" />
                  </svg>
                </span>
                <p>
                  {data.birthday} <span>· день рождения</span>
                </p>
              </div>
            ) : null}
            {data.achievements.map((item) => (
              <div key={item.id} className="mate-fact">
                <span className="mate-fi" aria-hidden="true">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M7 3h10l-3 6h-4L7 3z" />
                    <circle cx="12" cy="15" r="6" />
                    <path d="M12 12.5l.9 1.8 2 .3-1.4 1.4.3 2-1.8-.9-1.8.9.3-2-1.4-1.4 2-.3z" />
                  </svg>
                </span>
                <p>
                  {item.title}
                  {item.year ? <span> · {item.year}</span> : null}
                </p>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      {/* приложение и так внутри Telegram — отдельной кнопки «Написать в Telegram» нет */}
      {primary ? (
        <div className="mate-act">
          <button
            type="button"
            className="ds-btn ds-btn-1"
            onClick={() => void primary.onClick()}
            disabled={congratulated}
          >
            {primary.label}
          </button>
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
          <div className="mate-bt2">
            <b>Бег</b>
            <span>последние 4 недели</span>
          </div>
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
                <span>пробежек</span>
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

      {data.personalBests.some((best) => best.result) ? (
        <PbGrid
          bests={data.personalBests}
          freshDistance={data.freshBestDistance}
          workoutHref={(id) => `/athlete/workouts/${id}`}
          caption="официальное время"
        />
      ) : null}

      {data.upcoming.length || data.past.length ? (
        <div className="mate-starts">
          {data.upcoming.length ? (
            <div className="ds-list">
              <b className="mate-lh">Впереди</b>
              {data.upcoming.map((race) => {
                const days = Math.round(
                  (new Date(race.race_date).getTime() -
                    new Date(new Date().toDateString()).getTime()) /
                    86_400_000,
                );
                return (
                  <div key={race.id} className="ds-li">
                    <div className="club-dd">
                      <b>{new Date(race.race_date).getDate()}</b>
                      <span>{MONTHS[new Date(race.race_date).getMonth()]}</span>
                    </div>
                    <div className="ds-m">
                      <b>{race.name}</b>
                      <span>
                        {formatKm(race.distance_meters, 1)} км
                        {race.goal_time_seconds
                          ? ` · цель ${formatRaceTime(race.goal_time_seconds)}`
                          : ""}{" "}
                        ·{" "}
                        {days <= 0
                          ? "сегодня"
                          : `через ${days} ${pluralRu(days, "день", "дня", "дней")}`}
                      </span>
                    </div>
                    {race.viewer_too ? (
                      <span className="ds-pill ds-pill-accent">вы тоже</span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
          {data.past.length ? (
            <div className="ds-list">
              <b className="mate-lh">
                Прошедшие старты
                <span>
                  {data.finished_count}{" "}
                  {pluralRu(data.finished_count, "старт", "старта", "стартов")}
                </span>
              </b>
              {data.past.map((race) => (
                <div key={race.id} className="ds-li">
                  <div className="club-dd">
                    <b>{new Date(race.race_date).getDate()}</b>
                    <span>{MONTHS[new Date(race.race_date).getMonth()]}</span>
                  </div>
                  <div className="ds-m">
                    <b>{race.name}</b>
                    <span>
                      {formatKm(race.distance_meters, 1)} км
                      {race.place_overall
                        ? ` · ${race.place_overall}${race.participants ? ` из ${race.participants.toLocaleString("ru-RU")}` : " место"}`
                        : ""}
                      {new Date(race.race_date).getFullYear() !==
                      new Date().getFullYear()
                        ? ` · ${new Date(race.race_date).getFullYear()}`
                        : ""}
                    </span>
                  </div>
                  <div className="mate-v">
                    <b>{formatRaceTime(race.official_time_seconds)}</b>
                    {race.is_record ? (
                      <span className="mate-pr">ЛР</span>
                    ) : null}
                  </div>
                </div>
              ))}
              {data.finished_count > data.past.length ? (
                <Link
                  to={`/athlete/athletes/${athlete.id}/runs?tab=results`}
                  className="ds-li mate-more"
                >
                  Все старты ({data.finished_count}) ›
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
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
