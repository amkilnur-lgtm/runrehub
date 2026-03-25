import { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireAuth, requireRole } from "../lib/auth.js";
import { pool } from "../lib/db.js";
import { buildNextCursor, hasPartialCursor } from "../lib/pagination.js";
import { ensureActivityStreams, getStravaAuthUrl, syncLatestActivities } from "../lib/strava.js";

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
          select u.id, u.full_name, u.username, u.avatar_url, sc.connected_at, sc.last_synced_at
          from users u
          left join strava_connections sc on sc.user_id = u.id
          where u.id = $1
        `,
        [request.user.id]
      ),
      hasCursor
        ? pool.query(
            `
              select id, name, sport_type, start_date, distance_meters, moving_time_seconds,
                     elevation_gain, average_speed, average_heartrate
              from workouts
              where user_id = $1
                and (
                  start_date < $2::timestamptz
                  or (start_date = $2::timestamptz and id < $3)
                )
              order by start_date desc, id desc
              limit $4
            `,
            [request.user.id, beforeDate, beforeId, WORKOUTS_PAGE_SIZE]
          )
        : pool.query(
            `
              select id, name, sport_type, start_date, distance_meters, moving_time_seconds,
                     elevation_gain, average_speed, average_heartrate
              from workouts
              where user_id = $1
              order by start_date desc, id desc
              limit $2
            `,
            [request.user.id, WORKOUTS_PAGE_SIZE]
          ),
      pool.query<AthleteStatsRow>(
        `
          select
            coalesce(sum(distance_meters) filter (where start_date >= date_trunc('week', now())), 0) as week_distance_meters,
            coalesce(sum(moving_time_seconds) filter (where start_date >= date_trunc('week', now())), 0) as week_moving_time_seconds,
            coalesce(sum(elevation_gain) filter (where start_date >= date_trunc('week', now())), 0) as week_elevation_gain,
            count(*) filter (where start_date >= date_trunc('week', now())) as week_workout_count,
            coalesce(sum(distance_meters) filter (where start_date >= date_trunc('month', now())), 0) as month_distance_meters,
            coalesce(sum(moving_time_seconds) filter (where start_date >= date_trunc('month', now())), 0) as month_moving_time_seconds,
            coalesce(sum(elevation_gain) filter (where start_date >= date_trunc('month', now())), 0) as month_elevation_gain,
            count(*) filter (where start_date >= date_trunc('month', now())) as month_workout_count,
            coalesce(sum(distance_meters) filter (where start_date >= date_trunc('year', now())), 0) as year_distance_meters,
            coalesce(sum(moving_time_seconds) filter (where start_date >= date_trunc('year', now())), 0) as year_moving_time_seconds,
            coalesce(sum(elevation_gain) filter (where start_date >= date_trunc('year', now())), 0) as year_elevation_gain,
            count(*) filter (where start_date >= date_trunc('year', now())) as year_workout_count,
            coalesce(sum(distance_meters), 0) as all_time_distance_meters,
            coalesce(sum(moving_time_seconds), 0) as all_time_moving_time_seconds,
            coalesce(sum(elevation_gain), 0) as all_time_elevation_gain,
            count(*) as all_time_workout_count
          from workouts
          where user_id = $1
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

  app.get("/api/athlete/strava/connect", { preHandler: requireAuth }, async (request) => {
    requireRole(request, ["athlete"]);
    return { url: getStravaAuthUrl() };
  });

  app.post(
    "/api/athlete/strava/sync",
    {
      preHandler: requireAuth,
      config: {
        rateLimit: {
          max: 3,
          timeWindow: "1 minute"
        }
      }
    },
    async (request) => {
      requireRole(request, ["athlete"]);
      return syncLatestActivities(request.user.id);
    }
  );

  app.delete("/api/athlete/strava/disconnect", { preHandler: requireAuth }, async (request) => {
    requireRole(request, ["athlete"]);
    await pool.query(`delete from strava_connections where user_id = $1`, [request.user.id]);
    return { ok: true };
  });

  app.get("/api/athlete/workouts/:id", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["athlete"]);
    const params = request.params as { id: string };
    const workoutId = Number(params.id);
    const workoutResult = await pool.query(
      `select * from workouts where id = $1 and user_id = $2`,
      [workoutId, request.user.id]
    );

    if (!workoutResult.rows[0]) {
      return reply.code(404).send({ message: "Тренировка не найдена" });
    }

    const lapsResult = await pool.query(
      `select * from workout_laps where workout_id = $1 order by id asc`,
      [workoutId]
    );

    const streams = await ensureActivityStreams(
      request.user.id,
      workoutId,
      workoutResult.rows[0].strava_activity_id as number
    );

    return {
      workout: workoutResult.rows[0],
      laps: lapsResult.rows,
      streams
    };
  });

  app.delete("/api/athlete/workouts/:id", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["athlete"]);
    const params = request.params as { id: string };
    const workoutId = Number(params.id);

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
