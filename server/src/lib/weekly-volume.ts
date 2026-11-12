import { pool } from "./db.js";

// Сколько недель показываем в таблице группы и на столбиках спортсмена
export const VOLUME_WEEKS = 10;
// Серию недель с пробежками считаем на этой глубине
const STREAK_LOOKBACK_WEEKS = 104;

export type WeeklyVolume = {
  weekStarts: string[];
  byUser: Map<number, number[]>;
};

// Километраж по неделям (пн–вс, как и остальная статистика: date_trunc('week')) —
// с учётом правок тренера; старая неделя первой, текущая последней
export async function getWeeklyVolume(userIds: number[], weeks = VOLUME_WEEKS): Promise<WeeklyVolume> {
  const { rows } = await pool.query(
    `
      with weeks as (
        select generate_series(
          date_trunc('week', now()) - ($2::int - 1) * interval '1 week',
          date_trunc('week', now()),
          interval '1 week'
        ) as week_start
      )
      select u.id as user_id, wk.week_start,
             coalesce(sum(coalesce(wc.corrected_distance_meters, w.distance_meters)), 0) as distance_meters
      from unnest($1::int[]) as u(id)
      cross join weeks wk
      left join workouts w
        on w.user_id = u.id
       and w.start_date >= wk.week_start
       and w.start_date < wk.week_start + interval '1 week'
      left join workout_corrections wc on wc.workout_id = w.id
      group by u.id, wk.week_start
      order by u.id, wk.week_start
    `,
    [userIds, weeks]
  );

  const weekStarts: string[] = [];
  const byUser = new Map<number, number[]>();
  for (const row of rows) {
    const userId = Number(row.user_id);
    const list = byUser.get(userId) ?? [];
    list.push(Number(row.distance_meters));
    byUser.set(userId, list);
    if (byUser.size === 1) {
      weekStarts.push(new Date(row.week_start).toISOString());
    }
  }
  return { weekStarts, byUser };
}

// Сколько недель подряд были пробежки. Текущая неделя ещё идёт: если в ней пока
// пусто, серия не обрывается и считается от прошлой недели
export function countWeekStreak(hasRunByWeek: boolean[]): number {
  let index = hasRunByWeek.length - 1;
  if (index >= 0 && !hasRunByWeek[index]) {
    index -= 1;
  }
  let streak = 0;
  while (index >= 0 && hasRunByWeek[index]) {
    streak += 1;
    index -= 1;
  }
  return streak;
}

export async function getWeekStreak(userId: number): Promise<number> {
  const { rows } = await pool.query(
    `
      with weeks as (
        select generate_series(
          date_trunc('week', now()) - ($2::int - 1) * interval '1 week',
          date_trunc('week', now()),
          interval '1 week'
        ) as week_start
      )
      select exists (
        select 1 from workouts w
        where w.user_id = $1 and w.start_date >= wk.week_start and w.start_date < wk.week_start + interval '1 week'
      ) as has_run
      from weeks wk
      order by wk.week_start
    `,
    [userId, STREAK_LOOKBACK_WEEKS]
  );
  return countWeekStreak(rows.map((row) => Boolean(row.has_run)));
}

// Обратная связь тренера — это заметка тренера к тренировке или его комментарий в обсуждении
export const HAS_COACH_FEEDBACK_SQL = `(
  nullif(btrim(w.coach_comment), '') is not null
  or exists (select 1 from workout_comments c where c.workout_id = w.id and c.author_id = u.coach_id)
)`;

// Разбор закрыт: есть обратная связь тренера или он нажал «Пропустить» (review_skips)
export const REVIEW_DONE_SQL = `(
  ${HAS_COACH_FEEDBACK_SQL}
  or exists (select 1 from review_skips rs where rs.workout_id = w.id and rs.coach_id = u.coach_id)
)`;
