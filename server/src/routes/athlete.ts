import { FastifyInstance } from "fastify";
import { z } from "zod";

import { getAthleteTrends } from "../lib/athlete-trends.js";
import { requireAuth, requireRole } from "../lib/auth.js";
import { pool } from "../lib/db.js";
import { buildNextCursor, hasPartialCursor } from "../lib/pagination.js";
import {
  getAthleteFeed,
  getAthleteOverview,
  getWorkoutLikeState,
  isAthleteInGroup,
  isWorkoutInGroup
} from "../lib/social.js";
import { getStoredActivityStreams, markStravaActivityDeleted } from "../lib/strava.js";
import { applyWorkoutCorrectionToView, getActiveWorkoutCorrection } from "../lib/workout-gps-fix.js";

const workoutCursorQuerySchema = z.object({
  beforeDate: z.string().datetime().optional(),
  beforeId: z.coerce.number().int().positive().optional()
});

const workoutRenameSchema = z.object({
  name: z.string().trim().min(1)
});

const WORKOUTS_PAGE_SIZE = 10;

type AthleteStatsRow = {
  week_distance_meters: number | string | null;
  week_moving_time_seconds: number | string | null;
  week_elevation_gain: number | string | null;
  week_workout_count: number | string | null;
  month_distance_meters: number | string | null;
  month_moving_time_seconds: number | string | null;
  month_elevation_gain: number | string | null;
  month_workout_count: number | string | null;
  year_distance_meters: number | string | null;
  year_moving_time_seconds: number | string | null;
  year_elevation_gain: number | string | null;
  year_workout_count: number | string | null;
  all_time_distance_meters: number | string | null;
  all_time_moving_time_seconds: number | string | null;
  all_time_elevation_gain: number | string | null;
  all_time_workout_count: number | string | null;
};

export async function athleteRoutes(app: FastifyInstance) {
  app.get("/api/athlete/dashboard", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["athlete"]);
    const query = workoutCursorQuerySchema.parse(request.query);
    if (hasPartialCursor(query)) {
      return reply.code(400).send({ message: "Invalid workout cursor" });
    }
    const beforeDate = query.beforeDate ?? null;
    const beforeId = query.beforeId ?? null;
    const hasCursor = beforeDate !== null && beforeId !== null;

    const [profileResult, workoutsResult, statsResult] = await Promise.all([
      pool.query(
        `
          select
            u.id, u.full_name, u.username, u.avatar_url,
            ic.connected_at as connected_at,
            ic.last_synced_at as last_synced_at,
            case when ic.user_id is not null then 'intervals' end as provider
          from users u
          left join intervals_connections ic on ic.user_id = u.id
          where u.id = $1
        `,
        [request.user.id]
      ),
      hasCursor
        ? pool.query(
            `
              select
                w.id,
                w.name,
                w.sport_type,
                w.start_date,
                coalesce(wc.corrected_distance_meters, w.distance_meters) as distance_meters,
                coalesce(wc.corrected_moving_time_seconds, w.moving_time_seconds) as moving_time_seconds,
                coalesce(wc.corrected_elevation_gain, w.elevation_gain) as elevation_gain,
                coalesce(wc.corrected_average_speed, w.average_speed) as average_speed,
                coalesce(wc.corrected_average_heartrate, w.average_heartrate) as average_heartrate
              from workouts w
              left join workout_corrections wc on wc.workout_id = w.id
              where w.user_id = $1
                and (
                  w.start_date < $2::timestamptz
                  or (w.start_date = $2::timestamptz and w.id < $3)
                )
              order by w.start_date desc, w.id desc
              limit $4
            `,
            [request.user.id, beforeDate, beforeId, WORKOUTS_PAGE_SIZE]
          )
        : pool.query(
            `
              select
                w.id,
                w.name,
                w.sport_type,
                w.start_date,
                coalesce(wc.corrected_distance_meters, w.distance_meters) as distance_meters,
                coalesce(wc.corrected_moving_time_seconds, w.moving_time_seconds) as moving_time_seconds,
                coalesce(wc.corrected_elevation_gain, w.elevation_gain) as elevation_gain,
                coalesce(wc.corrected_average_speed, w.average_speed) as average_speed,
                coalesce(wc.corrected_average_heartrate, w.average_heartrate) as average_heartrate
              from workouts w
              left join workout_corrections wc on wc.workout_id = w.id
              where w.user_id = $1
              order by w.start_date desc, w.id desc
              limit $2
            `,
            [request.user.id, WORKOUTS_PAGE_SIZE]
          ),
      pool.query<AthleteStatsRow>(
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
        [request.user.id]
      )
    ]);

    const workouts = workoutsResult.rows;
    const stats = statsResult.rows[0];
    return {
      athlete: profileResult.rows[0],
      stats: {
        week: {
          distance_meters: Number(stats?.week_distance_meters ?? 0),
          moving_time_seconds: Number(stats?.week_moving_time_seconds ?? 0),
          elevation_gain: Number(stats?.week_elevation_gain ?? 0),
          workout_count: Number(stats?.week_workout_count ?? 0)
        },
        month: {
          distance_meters: Number(stats?.month_distance_meters ?? 0),
          moving_time_seconds: Number(stats?.month_moving_time_seconds ?? 0),
          elevation_gain: Number(stats?.month_elevation_gain ?? 0),
          workout_count: Number(stats?.month_workout_count ?? 0)
        },
        year: {
          distance_meters: Number(stats?.year_distance_meters ?? 0),
          moving_time_seconds: Number(stats?.year_moving_time_seconds ?? 0),
          elevation_gain: Number(stats?.year_elevation_gain ?? 0),
          workout_count: Number(stats?.year_workout_count ?? 0)
        },
        allTime: {
          distance_meters: Number(stats?.all_time_distance_meters ?? 0),
          moving_time_seconds: Number(stats?.all_time_moving_time_seconds ?? 0),
          elevation_gain: Number(stats?.all_time_elevation_gain ?? 0),
          workout_count: Number(stats?.all_time_workout_count ?? 0)
        }
      },
      workouts,
      nextCursor: buildNextCursor(workouts as Array<{ id: number; start_date: string }>, WORKOUTS_PAGE_SIZE)
    };
  });

  app.get("/api/athlete/trends", { preHandler: requireAuth }, async (request) => {
    requireRole(request, ["athlete"]);
    return getAthleteTrends(request.user.id);
  });

  // Лента команды: свежие пробежки своей группы (тот же тренер) + свои
  app.get("/api/athlete/feed", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["athlete"]);
    const query = workoutCursorQuerySchema.parse(request.query);
    if (hasPartialCursor(query)) {
      return reply.code(400).send({ message: "Invalid feed cursor" });
    }
    const cursor =
      query.beforeDate && query.beforeId
        ? { beforeDate: query.beforeDate, beforeId: query.beforeId }
        : null;
    return getAthleteFeed(request.user.id, cursor);
  });

  // Профиль одногруппника (или свой): шапка, сводка, пробежки — только чтение
  app.get("/api/athlete/athletes/:id", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["athlete"]);
    const athleteId = Number((request.params as { id: string }).id);
    const query = workoutCursorQuerySchema.parse(request.query);
    if (hasPartialCursor(query)) {
      return reply.code(400).send({ message: "Invalid workout cursor" });
    }
    if (!(await isAthleteInGroup(request.user.id, athleteId))) {
      return reply.code(404).send({ message: "Спортсмен не найден" });
    }
    const cursor =
      query.beforeDate && query.beforeId
        ? { beforeDate: query.beforeDate, beforeId: query.beforeId }
        : null;
    const overview = await getAthleteOverview(athleteId, cursor);
    if (!overview) {
      return reply.code(404).send({ message: "Спортсмен не найден" });
    }
    return overview;
  });

  app.get("/api/athlete/athletes/:id/trends", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["athlete"]);
    const athleteId = Number((request.params as { id: string }).id);
    if (!(await isAthleteInGroup(request.user.id, athleteId))) {
      return reply.code(404).send({ message: "Спортсмен не найден" });
    }
    return getAthleteTrends(athleteId);
  });

  app.post("/api/athlete/workouts/:id/like", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["athlete"]);
    const workoutId = Number((request.params as { id: string }).id);
    if (!(await isWorkoutInGroup(request.user.id, workoutId))) {
      return reply.code(404).send({ message: "Тренировка не найдена" });
    }
    await pool.query(
      `insert into workout_likes (workout_id, user_id) values ($1, $2)
       on conflict (workout_id, user_id) do nothing`,
      [workoutId, request.user.id]
    );
    return { ok: true, ...(await getWorkoutLikeState(workoutId, request.user.id)) };
  });

  app.delete("/api/athlete/workouts/:id/like", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["athlete"]);
    const workoutId = Number((request.params as { id: string }).id);
    if (!(await isWorkoutInGroup(request.user.id, workoutId))) {
      return reply.code(404).send({ message: "Тренировка не найдена" });
    }
    await pool.query(
      `delete from workout_likes where workout_id = $1 and user_id = $2`,
      [workoutId, request.user.id]
    );
    return { ok: true, ...(await getWorkoutLikeState(workoutId, request.user.id)) };
  });

  app.get("/api/athlete/workouts/:id", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["athlete"]);
    const params = request.params as { id: string };
    const workoutId = Number(params.id);
    // Свою тренировку или тренировку одногруппника (тот же тренер) — read-only
    const workoutResult = await pool.query(
      `
        select w.*, (w.user_id = $2) as is_owner
        from workouts w
        join users a on a.id = w.user_id
        join users me on me.id = $2
        where w.id = $1
          and (
            w.user_id = $2
            or (a.role = 'athlete' and me.coach_id is not null and a.coach_id = me.coach_id)
          )
      `,
      [workoutId, request.user.id]
    );

    if (!workoutResult.rows[0]) {
      return reply.code(404).send({ message: "Тренировка не найдена" });
    }

    const lapsResult = await pool.query(
      `select * from workout_laps where workout_id = $1 order by id asc`,
      [workoutId]
    );

    const streams = await getStoredActivityStreams(workoutId);

    const correction = await getActiveWorkoutCorrection(workoutId);
    const correctedView = applyWorkoutCorrectionToView(
      workoutResult.rows[0],
      lapsResult.rows,
      streams,
      correction
    );

    return { ...correctedView, like: await getWorkoutLikeState(workoutId, request.user.id) };
  });

  app.delete("/api/athlete/workouts/:id", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["athlete"]);
    const params = request.params as { id: string };
    const workoutId = Number(params.id);

    const existingWorkoutResult = await pool.query(
      `select strava_activity_id from workouts where id = $1 and user_id = $2`,
      [workoutId, request.user.id]
    );
    const existingWorkout = existingWorkoutResult.rows[0] as
      | { strava_activity_id: number | null }
      | undefined;

    if (!existingWorkout) {
      return reply.code(404).send({ message: "РўСЂРµРЅРёСЂРѕРІРєР° РЅРµ РЅР°Р№РґРµРЅР°" });
    }

    if (existingWorkout.strava_activity_id) {
      await markStravaActivityDeleted(request.user.id, Number(existingWorkout.strava_activity_id));
    }

    const { rowCount } = await pool.query(
      `delete from workouts where id = $1 and user_id = $2`,
      [workoutId, request.user.id]
    );

    if (rowCount === 0) {
      return reply.code(404).send({ message: "Тренировка не найдена" });
    }

    return { ok: true };
  });

  app.put("/api/athlete/workouts/:id/name", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["athlete"]);
    const params = request.params as { id: string };
    const body = workoutRenameSchema.parse(request.body);
    const workoutId = Number(params.id);

    const result = await pool.query(
      `
        update workouts
        set name = $3,
            custom_name = $3
        where id = $1 and user_id = $2
        returning name
      `,
      [workoutId, request.user.id, body.name]
    );

    if (!result.rows[0]) {
      return reply.code(404).send({ message: "Тренировка не найдена" });
    }

    return { ok: true, name: result.rows[0].name };
  });
}
