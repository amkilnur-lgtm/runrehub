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

const WORKOUTS_PAGE_SIZE = 10;

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

    const [profileResult, workoutsResult] = await Promise.all([
      pool.query(
        `
          select u.id, u.full_name, u.username, sc.connected_at, sc.last_synced_at
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
          )
    ]);

    const workouts = workoutsResult.rows;
    return {
      athlete: profileResult.rows[0],
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
}
