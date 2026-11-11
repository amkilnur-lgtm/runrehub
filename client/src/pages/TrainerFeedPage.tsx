import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { AthleteFeed } from "../components/AthleteFeed";
import { useToast } from "../components/ToastProvider";
import { congratulate as sendCongrats } from "../lib-congrats";
import { BirthdayDialog } from "../components/BirthdayDialog";
import { UserAvatar } from "../components/UserAvatar";
import { forgetApiCache, useApi } from "../hooks/useApi";
import { formatAgo, formatKm, pluralRu } from "../lib";

// «Клуб» по исследованию: сверху — день рождения сегодня с одной кнопкой,
// дальше «Лента · Состав». В составе — ближайшие дни рождения и все атлеты: тренер первым, остальные по фамилии.

type Person = {
  id: number;
  full_name: string;
  avatar_url: string | null;
  is_coach: boolean;
  is_me: boolean;
  member_since: string;
  last_run_at: string | null;
  last_workout_id: number | null;
  birthday: {
    day: number;
    month: number;
    label: string;
    days: number;
    hidden: boolean;
  } | null;
  recovering?: boolean;
  is_new?: boolean;
  weeks?: number[];
};
type Club = {
  coach: Person | null;
  athletes: Person[];
  today: Person[];
  upcoming: Person[];
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


function inDays(days: number) {
  if (days === 1) return "завтра";
  return `через ${days} ${pluralRu(days, "день", "дня", "дней")}`;
}

function sinceLabel(person: Person) {
  if (person.last_run_at)
    return `последняя пробежка ${formatAgo(person.last_run_at)}`;
  const date = new Date(person.member_since);
  return `в клубе с ${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

export function TrainerFeedPage({
  viewer = "trainer",
}: {
  viewer?: "trainer" | "athlete";
}) {
  const base = viewer === "trainer" ? "/api/trainer" : "/api/athlete";
  const { data: club, refresh } = useApi<Club>(`${base}/club`);
  const [search, setSearch] = useSearchParams();
  const tab = search.get("tab") === "roster" ? "roster" : "feed";
  const showToast = useToast();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);

  const profileHref = (person: Person) =>
    viewer === "trainer"
      ? `/trainer/athletes/${person.id}`
      : person.is_me
        ? "/athlete"
        : `/athlete/athletes/${person.id}`;
  // поздравление — лайк последней пробежки (общение — в чате группы в Telegram); тренер — открывает спортсмена
  const congratulate = async (person: Person) => {
    if (viewer === "trainer" || !person.last_workout_id) {
      navigate(profileHref(person));
      return;
    }
    try {
      await sendCongrats(person.last_workout_id);
      showToast("success", `Поздравили — ${person.full_name.split(" ")[0]} увидит лайк`);
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Не получилось");
    }
  };
  const me = club
    ? ([club.coach, ...club.athletes].find((person) => person?.is_me) ?? null)
    : null;
  const todayOthers = club?.today.filter((person) => !person.is_me) ?? [];
  const todayMe = club?.today.some((person) => person.is_me);

  return (
    <div className="ds-screen club">
      <header>
        <h1 className="ds-title">Клуб</h1>
        {club ? (
          <p className="ds-sub" style={{ marginTop: 2 }}>
            {club.coach ? `тренер ${club.coach.full_name} · ` : ""}
            {club.athletes.length}{" "}
            {pluralRu(club.athletes.length, "атлет", "атлета", "атлетов")}
          </p>
        ) : null}
      </header>

      {todayMe ? (
        <section className="ds-block ds-pad club-today">
          <b>С днём рождения! 🎉</b>
          <span>Клуб видит, что сегодня ваш день</span>
        </section>
      ) : null}
      {todayOthers.map((person) => (
        <section
          key={person.id}
          className="ds-block ds-pad club-today"
          aria-label="День рождения сегодня"
        >
          <div className="club-today-row">
            <UserAvatar
              fullName={person.full_name}
              avatarUrl={person.avatar_url}
              className="club-av"
            />
            <div>
              <b>Сегодня день рождения</b>
              <span>{person.full_name}</span>
            </div>
          </div>
          {/* тренер поздравляет в Telegram сам; спортсмену — лайк последней пробежки */}
          {viewer === "athlete" ? (
            <button type="button" className="ds-btn ds-btn-1" onClick={() => void congratulate(person)}>
              Поздравить
            </button>
          ) : null}
        </section>
      ))}

      <div className="ds-seg" role="group" aria-label="Раздел клуба">
        <button
          type="button"
          aria-pressed={tab === "feed"}
          onClick={() => setSearch({}, { replace: true })}
        >
          Лента
        </button>
        <button
          type="button"
          aria-pressed={tab === "roster"}
          onClick={() => setSearch({ tab: "roster" }, { replace: true })}
        >
          Состав
        </button>
      </div>

      {tab === "feed" ? (
        <AthleteFeed viewer={viewer} hideLeaders />
      ) : !club ? (
        <div
          className="skeleton-block"
          style={{ height: 320, borderRadius: 16 }}
        />
      ) : (
        <>
          {club.upcoming.length ? (
            <div>
              <div className="ds-grp">
                <span>Дни рождения · 2 недели</span>
              </div>
              <div className="ds-list">
                {club.upcoming.map((person) => (
                  <Link
                    key={person.id}
                    to={profileHref(person)}
                    className="ds-li"
                  >
                    <div className="club-dd">
                      <b>{person.birthday!.day}</b>
                      <span>{MONTHS[person.birthday!.month - 1]}</span>
                    </div>
                    <div className="ds-m">
                      <b>{person.full_name}</b>
                      <span>
                        {inDays(person.birthday!.days)}
                        {person.birthday!.hidden ? " · скрыт от клуба" : ""}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ) : null}

          {me && !me.birthday ? (
            <button
              type="button"
              className="ds-block ds-pad club-ask"
              onClick={() => setEditing(true)}
            >
              <b>Укажите свой день рождения</b>
              <span>клуб сможет поздравить · только день и месяц</span>
            </button>
          ) : null}

          <div>
            {/* состав (вариант А): тренер отдельно, у атлетов — км этой недели и 6 недель столбиками */}
            {club.coach ? (
              <div className="ds-block club-coach">
                <UserAvatar fullName={club.coach.full_name} avatarUrl={club.coach.avatar_url} className="club-av-lg" />
                <div>
                  <b>{club.coach.full_name}</b>
                  <span>
                    тренер · {club.athletes.length} {pluralRu(club.athletes.length, "атлет", "атлета", "атлетов")}
                  </span>
                </div>
              </div>
            ) : null}
            <div className="ds-grp" style={{ marginTop: 12 }}>
              <span>Атлеты · {club.athletes.length}</span>
              <span>эта неделя</span>
            </div>
            <div className="ds-list">
              {club.athletes.map((person) => {
                const weeks = person.weeks ?? [];
                const max = Math.max(...weeks, 1);
                const thisWeek = weeks[weeks.length - 1] ?? 0;
                const ranToday = person.last_run_at ? new Date(person.last_run_at).toDateString() === new Date().toDateString() : false;
                const tag =
                  person.birthday?.days === 0
                    ? { text: "ДР сегодня", cls: "is-gold" }
                    : person.birthday?.days === 1
                      ? { text: "ДР завтра", cls: "is-gold" }
                      : person.recovering
                        ? { text: "отдых", cls: "" }
                        : person.is_new
                          ? { text: "новенький", cls: "" }
                          : null;
                return (
                  <Link key={person.id} to={profileHref(person)} className="ds-li club-row">
                    <span className="club-avw">
                      <UserAvatar fullName={person.full_name} avatarUrl={person.avatar_url} className="club-av-lg" />
                      {ranToday ? <span className="club-today-dot" title="бегал(а) сегодня" /> : null}
                    </span>
                    <div className="ds-m">
                      <b>
                        {person.full_name}
                        {person.is_me ? <small className="club-me"> · вы</small> : null}
                        {tag ? <span className={`club-tag ${tag.cls}`}>{tag.text}</span> : null}
                      </b>
                      <span>{sinceLabel(person)}</span>
                    </div>
                    {weeks.some((value) => value > 0) ? (
                      <span className="club-wk" aria-hidden="true">
                        {weeks.map((value, index) => (
                          <i key={index} className={index === weeks.length - 1 ? "is-now" : undefined} style={{ height: `${Math.max(value ? (value / max) * 100 : 0, 10)}%` }} />
                        ))}
                      </span>
                    ) : null}
                    <span className={thisWeek ? "club-km" : "club-km is-zero"}>
                      {thisWeek ? formatKm(thisWeek) : "—"}
                      {thisWeek ? <small>км</small> : null}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </>
      )}

      {editing ? (
        <BirthdayDialog
          endpoint="/api/auth/birthday"
          onClose={() => setEditing(false)}
          onSaved={() => {
            forgetApiCache(`${base}/club`);
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}
