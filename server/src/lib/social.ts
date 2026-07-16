import { pool } from "./db.js";
import { buildNextCursor, type WorkoutCursor } from "./pagination.js";

export const FEED_PAGE_SIZE = 15;
const ROUTE_MAX_POINTS = 128;
const OVERVIEW_WORKOUTS_PAGE_SIZE = 10;

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
  route: [number, number][] | null;
};

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

export async function getAthleteFeed(viewerId: number, cursor: WorkoutCursor | null) {
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
        exists(select 1 from workout_likes wl where wl.workout_id = w.id and wl.user_id = $1) as liked_by_me
      from workouts w
      join users a on a.id = w.user_id
      join users me on me.id = $1
      left join workout_corrections wc on wc.workout_id = w.id
      where a.role = 'athlete'
        and (
          (me.coach_id is not null and a.coach_id = me.coach_id)
          or a.id = $1
        )${cursorClause}
      order by w.start_date desc, w.id desc
      limit $${limitIdx}
    `,
    params
  );

  const items = rows as Array<Record<string, unknown>>;
  const ids = items.map((r) => r.id as number);
  const routeById = new Map<number, [number, number][] | null>();
  if (ids.length) {
    const streamsResult = await pool.query(
      `select workout_id, latlng_stream from workout_streams where workout_id = any($1::int[])`,
      [ids]
    );
    for (const row of streamsResult.rows) {
      routeById.set(row.workout_id as number, downsampleRoute(row.latlng_stream));
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
