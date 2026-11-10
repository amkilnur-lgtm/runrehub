import { pool } from "./db.js";
import { escapeTelegramHtml, isTelegramConfigured, sendTelegramMessage } from "./telegram.js";

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
             u.birthday_day, u.birthday_month, u.birthday_hidden,
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
      birthday
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
