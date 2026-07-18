import { pool } from "./db.js";
import { buildNextCursor, type WorkoutCursor } from "./pagination.js";

export const FEED_PAGE_SIZE = 15;
const ROUTE_MAX_POINTS = 128;
const OVERVIEW_WORKOUTS_PAGE_SIZE = 10;

export type FeedLiker = {
  id: number;
  full_name: string;
  avatar_url: string | null;
};

export type FeedItem = {
  id: number;
  name: string;
  sport_type: string;
  start_date: string;
  athlete_id: number;
  athlete_name: string;
  athlete_username: string;
  athlete_avatar_url: string | null;
  distance_meters: number;
  moving_time_seconds: number;
  elevation_gain: number;
  average_speed: number | null;
  average_heartrate: number | null;
  like_count: number;
  liked_by_me: boolean;
  comment_count: number;
  likers: FeedLiker[];
  route: [number, number][] | null;
};

const FEED_LIKERS_PREVIEW = 3;

// Прореживаем latlng до <= ROUTE_MAX_POINTS точек для лёгкого трека в ленте
// (полная карта — только на странице разбора). Первую и последнюю точку сохраняем.
function downsampleRoute(latlng: unknown): [number, number][] | null {
  if (!Array.isArray(latlng) || latlng.length < 2) {
    return null;
  }
  const points = latlng.filter(
    (p): p is [number, number] =>
      Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])
  );
  if (points.length < 2) {
    return null;
  }
  if (points.length <= ROUTE_MAX_POINTS) {
    return points;
  }
  const step = (points.length - 1) / (ROUTE_MAX_POINTS - 1);
  const out: [number, number][] = [];
  for (let i = 0; i < ROUTE_MAX_POINTS; i += 1) {
    out.push(points[Math.round(i * step)]!);
  }
  out[out.length - 1] = points[points.length - 1]!;
  return out;
}

// Тренировка доступна атлету в ленте, если её автор — он сам
// или атлет из его группы (тот же тренер).
export async function isWorkoutInGroup(viewerId: number, workoutId: number): Promise<boolean> {
  const { rows } = await pool.query(
    `
      select 1
      from workouts w
      join users a on a.id = w.user_id
      join users me on me.id = $2
      where w.id = $1
        and (
          w.user_id = $2
          or (a.role = 'athlete' and me.coach_id is not null and a.coach_id = me.coach_id)
        )
      limit 1
    `,
    [workoutId, viewerId]
  );
  return rows.length > 0;
}

// Атлет-одногруппник: та же группа (общий тренер) либо сам зритель
export async function isAthleteInGroup(viewerId: number, athleteId: number): Promise<boolean> {
  if (viewerId === athleteId) {
    return true;
  }
  const { rows } = await pool.query(
    `
      select 1
      from users a
      join users me on me.id = $1
      where a.id = $2
        and a.role = 'athlete'
        and me.coach_id is not null
        and a.coach_id = me.coach_id
      limit 1
    `,
    [viewerId, athleteId]
  );
  return rows.length > 0;
}

// Профиль атлета для просмотра одногруппником: шапка + сводка + пробежки.
// Формат совпадает с /api/trainer/athletes/:id, чтобы страница могла переиспользовать вёрстку.
export async function getAthleteOverview(athleteId: number, cursor: WorkoutCursor | null) {
  const hasCursor = cursor !== null;

  const profileResult = await pool.query(
    `
      select
        u.id, u.full_name, u.username, u.avatar_url,
        ic.connected_at as connected_at,
        ic.last_synced_at as last_synced_at,
        case when ic.user_id is not null then 'intervals' end as provider
      from users u
      left join intervals_connections ic on ic.user_id = u.id
      where u.id = $1 and u.role = 'athlete'
    `,
    [athleteId]
  );
  if (!profileResult.rows[0]) {
    return null;
  }

  const workoutsQuery = hasCursor
    ? pool.query(
        `
          select
            w.id, w.name, w.sport_type, w.start_date,
            coalesce(wc.corrected_distance_meters, w.distance_meters) as distance_meters,
            coalesce(wc.corrected_moving_time_seconds, w.moving_time_seconds) as moving_time_seconds,
            coalesce(wc.corrected_average_speed, w.average_speed) as average_speed,
            coalesce(wc.corrected_average_heartrate, w.average_heartrate) as average_heartrate
          from workouts w
          left join workout_corrections wc on wc.workout_id = w.id
          where w.user_id = $1
            and (w.start_date < $2::timestamptz or (w.start_date = $2::timestamptz and w.id < $3))
          order by w.start_date desc, w.id desc
          limit $4
        `,
        [athleteId, cursor!.beforeDate, cursor!.beforeId, OVERVIEW_WORKOUTS_PAGE_SIZE]
      )
    : pool.query(
        `
          select
            w.id, w.name, w.sport_type, w.start_date,
            coalesce(wc.corrected_distance_meters, w.distance_meters) as distance_meters,
            coalesce(wc.corrected_moving_time_seconds, w.moving_time_seconds) as moving_time_seconds,
            coalesce(wc.corrected_average_speed, w.average_speed) as average_speed,
            coalesce(wc.corrected_average_heartrate, w.average_heartrate) as average_heartrate
          from workouts w
          left join workout_corrections wc on wc.workout_id = w.id
          where w.user_id = $1
          order by w.start_date desc, w.id desc
          limit $2
        `,
        [athleteId, OVERVIEW_WORKOUTS_PAGE_SIZE]
      );

  const statsQuery = pool.query(
    `
      select
        coalesce(sum(coalesce(wc.corrected_distance_meters, w.distance_meters)) filter (where w.start_date >= date_trunc('week', now())), 0) as week_distance_meters,
        coalesce(sum(coalesce(wc.corrected_moving_time_seconds, w.moving_time_seconds)) filter (where w.start_date >= date_trunc('week', now())), 0) as week_moving_time_seconds,
        coalesce(sum(coalesce(wc.corrected_elevation_gain, w.elevation_gain)) filter (where w.start_date >= date_trunc('week', now())), 0) as week_elevation_gain,
        count(*) filter (where w.start_date >= date_trunc('week', now())) as week_workout_count,
        coalesce(sum(coalesce(wc.corrected_distance_meters, w.distance_meters)) filter (where w.start_date >= date_trunc('month', now())), 0) as month_distance_meters,
        coalesce(sum(coalesce(wc.corrected_moving_time_seconds, w.moving_time_seconds)) filter (where w.start_date >= date_trunc('month', now())), 0) as month_moving_time_seconds,
        coalesce(sum(coalesce(wc.corrected_elevation_gain, w.elevation_gain)) filter (where w.start_date >= date_trunc('month', now())), 0) as month_elevation_gain,
        count(*) filter (where w.start_date >= date_trunc('month', now())) as month_workout_count,
        coalesce(sum(coalesce(wc.corrected_distance_meters, w.distance_meters)) filter (where w.start_date >= date_trunc('year', now())), 0) as year_distance_meters,
        coalesce(sum(coalesce(wc.corrected_moving_time_seconds, w.moving_time_seconds)) filter (where w.start_date >= date_trunc('year', now())), 0) as year_moving_time_seconds,
        coalesce(sum(coalesce(wc.corrected_elevation_gain, w.elevation_gain)) filter (where w.start_date >= date_trunc('year', now())), 0) as year_elevation_gain,
        count(*) filter (where w.start_date >= date_trunc('year', now())) as year_workout_count,
        coalesce(sum(coalesce(wc.corrected_distance_meters, w.distance_meters)), 0) as all_time_distance_meters,
        coalesce(sum(coalesce(wc.corrected_moving_time_seconds, w.moving_time_seconds)), 0) as all_time_moving_time_seconds,
        coalesce(sum(coalesce(wc.corrected_elevation_gain, w.elevation_gain)), 0) as all_time_elevation_gain,
        count(*) as all_time_workout_count
      from workouts w
      left join workout_corrections wc on wc.workout_id = w.id
      where w.user_id = $1
    `,
    [athleteId]
  );

  const [workoutsResult, statsResult] = await Promise.all([workoutsQuery, statsQuery]);
  const workouts = workoutsResult.rows;
  const stats = statsResult.rows[0] as Record<string, number | string | null>;
  const period = (prefix: string) => ({
    distance_meters: Number(stats?.[`${prefix}_distance_meters`] ?? 0),
    moving_time_seconds: Number(stats?.[`${prefix}_moving_time_seconds`] ?? 0),
    elevation_gain: Number(stats?.[`${prefix}_elevation_gain`] ?? 0),
    workout_count: Number(stats?.[`${prefix}_workout_count`] ?? 0)
  });

  return {
    athlete: profileResult.rows[0],
    stats: {
      week: period("week"),
      month: period("month"),
      year: period("year"),
      allTime: period("all_time")
    },
    workouts,
    nextCursor: buildNextCursor(
      workouts as Array<{ id: number; start_date: string }>,
      OVERVIEW_WORKOUTS_PAGE_SIZE
    )
  };
}

export async function getWorkoutLikers(workoutId: number) {
  const { rows } = await pool.query(
    `
      select u.id, u.full_name, u.username, u.avatar_url, u.role
      from workout_likes wl
      join users u on u.id = wl.user_id
      where wl.workout_id = $1
      order by wl.created_at desc
    `,
    [workoutId]
  );
  return rows;
}

export type WorkoutComment = {
  id: number;
  workout_id: number;
  body: string;
  created_at: string;
  author_id: number;
  author_name: string;
  author_username: string;
  author_avatar_url: string | null;
  author_is_trainer: boolean;
  can_delete: boolean;
};

// canModerate — тренер удаляет любые комментарии на тренировках своих атлетов
export async function listWorkoutComments(
  workoutId: number,
  viewerId: number,
  canModerate: boolean
): Promise<WorkoutComment[]> {
  const { rows } = await pool.query(
    `
      select
        c.id, c.workout_id, c.body, c.created_at,
        u.id as author_id, u.full_name as author_name, u.username as author_username,
        u.avatar_url as author_avatar_url, (u.role = 'trainer') as author_is_trainer
      from workout_comments c
      join users u on u.id = c.author_id
      where c.workout_id = $1
      order by c.created_at asc, c.id asc
    `,
    [workoutId]
  );
  return rows.map((r) => ({
    id: r.id as number,
    workout_id: r.workout_id as number,
    body: r.body as string,
    created_at: r.created_at as string,
    author_id: r.author_id as number,
    author_name: r.author_name as string,
    author_username: r.author_username as string,
    author_avatar_url: (r.author_avatar_url as string | null) ?? null,
    author_is_trainer: Boolean(r.author_is_trainer),
    can_delete: canModerate || (r.author_id as number) === viewerId
  }));
}

export async function addWorkoutComment(workoutId: number, authorId: number, body: string) {
  const { rows } = await pool.query(
    `insert into workout_comments (workout_id, author_id, body) values ($1, $2, $3) returning id`,
    [workoutId, authorId, body]
  );
  return rows[0]?.id as number;
}

export async function getWorkoutLikeState(workoutId: number, viewerId: number) {
  const { rows } = await pool.query(
    `
      select
        (select count(*) from workout_likes where workout_id = $1)::int as like_count,
        exists(select 1 from workout_likes where workout_id = $1 and user_id = $2) as liked_by_me
    `,
    [workoutId, viewerId]
  );
  return {
    like_count: Number(rows[0]?.like_count ?? 0),
    liked_by_me: Boolean(rows[0]?.liked_by_me)
  };
}

// Топ-3 недели по километражу — тот же расчёт, что в тренерском дашборде
export async function getGroupLeaders(coachId: number) {
  const { rows } = await pool.query(
    `
      select
        u.id, u.full_name, u.username, u.avatar_url,
        coalesce(sum(coalesce(wc.corrected_distance_meters, w.distance_meters))
          filter (where w.start_date >= date_trunc('week', now())), 0)::float8 as week_distance_meters,
        count(w.id) filter (where w.start_date >= date_trunc('week', now()))::int as week_workout_count
      from users u
      left join workouts w on w.user_id = u.id
      left join workout_corrections wc on wc.workout_id = w.id
      where u.role = 'athlete' and u.coach_id = $1
      group by u.id
      having count(w.id) filter (where w.start_date >= date_trunc('week', now())) > 0
      order by week_distance_meters desc, week_workout_count desc, u.full_name asc
      limit 3
    `,
    [coachId]
  );
  return rows;
}

// Общее тело фида: viewer ($1) для liked_by_me + условие принадлежности группе
async function queryFeed(viewerId: number, groupClause: string, cursor: WorkoutCursor | null) {
  const hasCursor = cursor !== null;
  const params: unknown[] = [viewerId];
  let cursorClause = "";
  if (hasCursor) {
    params.push(cursor!.beforeDate, cursor!.beforeId);
    cursorClause = `
      and (
        w.start_date < $2::timestamptz
        or (w.start_date = $2::timestamptz and w.id < $3)
      )`;
  }
  params.push(FEED_PAGE_SIZE);
  const limitIdx = params.length;

  const { rows } = await pool.query(
    `
      select
        w.id,
        w.name,
        w.sport_type,
        w.start_date,
        a.id as athlete_id,
        a.full_name as athlete_name,
        a.username as athlete_username,
        a.avatar_url as athlete_avatar_url,
        coalesce(wc.corrected_distance_meters, w.distance_meters)::float8 as distance_meters,
        coalesce(wc.corrected_moving_time_seconds, w.moving_time_seconds)::float8 as moving_time_seconds,
        coalesce(wc.corrected_elevation_gain, w.elevation_gain)::float8 as elevation_gain,
        coalesce(wc.corrected_average_speed, w.average_speed)::float8 as average_speed,
        coalesce(wc.corrected_average_heartrate, w.average_heartrate)::float8 as average_heartrate,
        (select count(*) from workout_likes wl where wl.workout_id = w.id)::int as like_count,
        exists(select 1 from workout_likes wl where wl.workout_id = w.id and wl.user_id = $1) as liked_by_me,
        (select count(*) from workout_comments cm where cm.workout_id = w.id)::int as comment_count
      from workouts w
      join users a on a.id = w.user_id
      join users me on me.id = $1
      left join workout_corrections wc on wc.workout_id = w.id
      where a.role = 'athlete'
        and (${groupClause})${cursorClause}
      order by w.start_date desc, w.id desc
      limit $${limitIdx}
    `,
    params
  );
  return rows as Array<Record<string, unknown>>;
}

export async function getAthleteFeed(viewerId: number, cursor: WorkoutCursor | null) {
  const items = await queryFeed(
    viewerId,
    `(me.coach_id is not null and a.coach_id = me.coach_id) or a.id = $1`,
    cursor
  );
  return hydrateFeed(items);
}

// Лента тренера: пробежки его атлетов; liked_by_me — лайки самого тренера
export async function getTrainerFeed(trainerId: number, cursor: WorkoutCursor | null) {
  const items = await queryFeed(trainerId, `a.coach_id = $1`, cursor);
  return hydrateFeed(items);
}

async function hydrateFeed(items: Array<Record<string, unknown>>) {
  const ids = items.map((r) => r.id as number);
  const routeById = new Map<number, [number, number][] | null>();
  const likersById = new Map<number, FeedLiker[]>();
  if (ids.length) {
    const [streamsResult, likersResult] = await Promise.all([
      pool.query(
        `select workout_id, latlng_stream from workout_streams where workout_id = any($1::int[])`,
        [ids]
      ),
      pool.query(
        `
          select wl.workout_id, u.id, u.full_name, u.avatar_url
          from workout_likes wl
          join users u on u.id = wl.user_id
          where wl.workout_id = any($1::int[])
          order by wl.created_at desc
        `,
        [ids]
      )
    ]);
    for (const row of streamsResult.rows) {
      routeById.set(row.workout_id as number, downsampleRoute(row.latlng_stream));
    }
    for (const row of likersResult.rows) {
      const list = likersById.get(row.workout_id as number) ?? [];
      if (list.length < FEED_LIKERS_PREVIEW) {
        list.push({
          id: row.id as number,
          full_name: row.full_name as string,
          avatar_url: (row.avatar_url as string | null) ?? null
        });
        likersById.set(row.workout_id as number, list);
      }
    }
  }

  const feed: FeedItem[] = items.map((r) => ({
    id: r.id as number,
    name: r.name as string,
    sport_type: r.sport_type as string,
    start_date: r.start_date as string,
    athlete_id: r.athlete_id as number,
    athlete_name: r.athlete_name as string,
    athlete_username: r.athlete_username as string,
    athlete_avatar_url: (r.athlete_avatar_url as string | null) ?? null,
    distance_meters: Number(r.distance_meters ?? 0),
    moving_time_seconds: Number(r.moving_time_seconds ?? 0),
    elevation_gain: Number(r.elevation_gain ?? 0),
    average_speed: r.average_speed == null ? null : Number(r.average_speed),
    average_heartrate: r.average_heartrate == null ? null : Number(r.average_heartrate),
    like_count: Number(r.like_count ?? 0),
    liked_by_me: Boolean(r.liked_by_me),
    comment_count: Number(r.comment_count ?? 0),
    likers: likersById.get(r.id as number) ?? [],
    route: routeById.get(r.id as number) ?? null
  }));

  return {
    feed,
    nextCursor: buildNextCursor(
      items as Array<{ id: number; start_date: string }>,
      FEED_PAGE_SIZE
    )
  };
}
