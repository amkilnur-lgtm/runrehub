import { pool } from "./db.js";
import { escapeTelegramHtml, isTelegramConfigured, sendTelegramMessage } from "./telegram.js";
import { getWeeklyVolume } from "./weekly-volume.js";

// «Клуб»: состав группы и дни рождения. День рождения — только день и месяц;
// клубу виден, пока спортсмен его не скрыл; тренер видит всегда.
const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const UPCOMING_DAYS = 14;

export function formatBirthday(day: number, month: number) {
  return `${day} ${MONTHS[month - 1]}`;
}

// сколько дней до ближайшего дня рождения (0 — сегодня); 29 февраля в невисокосный год — 28-го
function daysUntil(day: number, month: number, today: Date) {
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  for (const year of [base.getFullYear(), base.getFullYear() + 1]) {
    const last = new Date(year, month, 0).getDate();
    const date = new Date(year, month - 1, Math.min(day, last));
    const diff = Math.round((date.getTime() - base.getTime()) / 86_400_000);
    if (diff >= 0) return diff;
  }
  return 365;
}

export async function getClub(viewerId: number, coachId: number, viewerIsCoach: boolean) {
  const { rows } = await pool.query(
    `
      select u.id, u.full_name, u.avatar_url, u.role, u.created_at, u.telegram_username,
             u.birthday_day, u.birthday_month, u.birthday_hidden, u.recovering,
             last.id as last_workout_id, last.start_date as last_run_at
      from users u
      left join lateral (
        select w.id, w.start_date from workouts w where w.user_id = u.id order by w.start_date desc, w.id desc limit 1
      ) last on true
      where u.id = $1 or (u.coach_id = $1 and u.role = 'athlete')
    `,
    [coachId]
  );
  const today = new Date();
  // состав (вариант А): км этой недели и 6 недель столбиками — без рейтинга, порядок по фамилии
  const volume = await getWeeklyVolume(rows.map((row) => Number(row.id)), 6);
  const people = rows.map((row) => {
    const visible = row.birthday_day && row.birthday_month && (viewerIsCoach || !row.birthday_hidden || row.id === viewerId);
    const birthday = visible
      ? {
          day: Number(row.birthday_day),
          month: Number(row.birthday_month),
          label: formatBirthday(Number(row.birthday_day), Number(row.birthday_month)),
          days: daysUntil(Number(row.birthday_day), Number(row.birthday_month), today),
          hidden: Boolean(row.birthday_hidden)
        }
      : null;
    return {
      id: Number(row.id),
      full_name: String(row.full_name),
      avatar_url: row.avatar_url ?? null,
      is_coach: row.role === "trainer",
      is_me: Number(row.id) === viewerId,
      member_since: row.created_at,
      last_run_at: row.last_run_at ?? null,
      last_workout_id: row.last_workout_id ? Number(row.last_workout_id) : null,
      telegram_username: row.telegram_username ?? null,
      birthday,
      recovering: Boolean(row.recovering),
      is_new: Date.now() - new Date(row.created_at).getTime() < 30 * 86_400_000,
      weeks: volume.byUser.get(Number(row.id)) ?? []
    };
  });
  // фамилия — последнее слово ФИО («Анна Бегунова» → «Бегунова»)
  const surname = (name: string) => name.trim().split(/\s+/).at(-1)!.toLocaleLowerCase("ru");
  const coach = people.find((person) => person.is_coach) ?? null;
  const athletes = people
    .filter((person) => !person.is_coach)
    .sort((a, b) => surname(a.full_name).localeCompare(surname(b.full_name), "ru") || a.full_name.localeCompare(b.full_name, "ru"));
  const withBirthday = people.filter((person) => person.birthday && !(person.birthday.hidden && !viewerIsCoach));
  return {
    coach,
    athletes,
    today: withBirthday.filter((person) => person.birthday!.days === 0),
    upcoming: withBirthday
      .filter((person) => person.birthday!.days > 0 && person.birthday!.days <= UPCOMING_DAYS)
      .sort((a, b) => a.birthday!.days - b.birthday!.days)
  };
}

// Напоминание тренеру накануне — личным сообщением бота, раз в год на человека
export async function notifyCoachesAboutBirthdays(now = new Date()) {
  // не ночью: напоминание приходит с 10 утра по времени сервера
  if (!isTelegramConfigured() || now.getHours() < 10) return;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const { rows } = await pool.query(
    `
      select a.id, a.full_name, c.telegram_chat_id
      from users a join users c on c.id = a.coach_id
      where a.role = 'athlete' and a.birthday_day = $1 and a.birthday_month = $2
        and c.telegram_chat_id is not null and c.telegram_notifications_enabled
        and (a.birthday_notified_on is null or a.birthday_notified_on < current_date - interval '300 days')
    `,
    [tomorrow.getDate(), tomorrow.getMonth() + 1]
  );
  for (const row of rows) {
    await sendTelegramMessage(
      row.telegram_chat_id,
      `🎂 Завтра день рождения у <b>${escapeTelegramHtml(row.full_name)}</b> — ${formatBirthday(tomorrow.getDate(), tomorrow.getMonth() + 1)}`
    );
    await pool.query(`update users set birthday_notified_on = current_date where id = $1`, [row.id]);
  }
}

// «В клубе» внизу главной спортсмена: 2–3 поддерживающих события — день рождения сегодня,
// свежий личный рекорд (7 дней), возвращение после паузы (первая пробежка после 14+ дней).
// Чужих темпа и пульса здесь нет.
export async function getClubEvents(viewerId: number, coachId: number) {
  const club = await getClub(viewerId, coachId, false);
  const mates = club.athletes.filter((person) => !person.is_me);
  const events: { kind: "birthday" | "record" | "return"; athlete_id: number; full_name: string; avatar_url: string | null; text: string; sub: string; workout_id: number | null }[] = [];
  for (const person of club.today.filter((p) => !p.is_me && !p.is_coach)) {
    events.push({ kind: "birthday", athlete_id: person.id, full_name: person.full_name, avatar_url: person.avatar_url, text: `Сегодня день рождения у ${person.full_name.split(" ")[0]}`, sub: "поздравить", workout_id: person.last_workout_id });
  }
  if (!mates.length) return { events };
  const ids = mates.map((p) => p.id);
  const [records, returns] = await Promise.all([
    pool.query(
      `select r.user_id, r.name, r.race_date, r.distance_meters, r.official_time_seconds, r.workout_id
       from race_results r
       where r.user_id = any($1::int[]) and r.status = 'finished' and r.official_time_seconds is not null
         and r.race_date >= current_date - 7
         and not exists (
           select 1 from race_results b where b.user_id = r.user_id and b.status = 'finished'
             and b.distance_meters = r.distance_meters and b.official_time_seconds <= r.official_time_seconds and b.id <> r.id
             and b.race_date <= r.race_date
         )
       order by r.race_date desc`,
      [ids]
    ),
    pool.query(
      `select w.user_id, w.id, w.start_date,
              (select max(p.start_date) from workouts p where p.user_id = w.user_id and p.start_date < w.start_date) as prev
       from workouts w
       where w.user_id = any($1::int[]) and w.start_date >= now() - interval '3 days'
         and w.start_date = (select max(x.start_date) from workouts x where x.user_id = w.user_id)`,
      [ids]
    )
  ]);
  const byId = new Map(mates.map((p) => [p.id, p]));
  const km = (m: number) => (m >= 42000 && m <= 42400 ? "марафоне" : m >= 21000 && m <= 21200 ? "полумарафоне" : `${Math.round(m / 1000)} км`);
  const time = (s: number) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
  };
  for (const row of records.rows) {
    const person = byId.get(Number(row.user_id));
    if (!person) continue;
    events.push({ kind: "record", athlete_id: person.id, full_name: person.full_name, avatar_url: person.avatar_url, text: `${person.full_name.split(" ")[0]} — личный рекорд на ${km(Number(row.distance_meters))}`, sub: `${time(Number(row.official_time_seconds))} · ${row.name}`, workout_id: row.workout_id ?? person.last_workout_id });
  }
  for (const row of returns.rows) {
    const person = byId.get(Number(row.user_id));
    if (!person || !row.prev) continue;
    const gap = Math.floor((new Date(row.start_date).getTime() - new Date(row.prev).getTime()) / 86_400_000);
    if (gap < 14) continue;
    const weeks = Math.round(gap / 7);
    events.push({ kind: "return", athlete_id: person.id, full_name: person.full_name, avatar_url: person.avatar_url, text: `${person.full_name.split(" ")[0]} снова на пробежках`, sub: `первая пробежка за ${weeks} ${weeks === 1 ? "неделю" : weeks < 5 ? "недели" : "недель"}`, workout_id: Number(row.id) });
  }
  return { events: events.slice(0, 3) };
}
