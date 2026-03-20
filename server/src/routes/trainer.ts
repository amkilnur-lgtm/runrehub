import { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireAuth, requireRole } from "../lib/auth.js";
import { pool } from "../lib/db.js";
import { buildNextCursor, hasPartialCursor } from "../lib/pagination.js";
import { ensureActivityStreams } from "../lib/strava.js";

const workoutCursorQuerySchema = z.object({
  beforeDate: z.string().datetime().optional(),
  beforeId: z.coerce.number().int().positive().optional()
});

const ATHLETE_WORKOUTS_PAGE_SIZE = 20;

export async function trainerRoutes(app: FastifyInstance) {
  // Оба запроса независимы — запускаем параллельно через Promise.all
  app.get("/api/trainer/dashboard", { preHandler: requireAuth }, async (request) => {
    requireRole(request, ["trainer"]);

    const [athletesResult, workoutsResult] = await Promise.all([
      pool.query(
        `
          select u.id, u.full_name, u.username, u.avatar_url,
                 (select max(start_date) from workouts w where w.user_id = u.id) as last_workout_at
          from users u
          where u.role = 'athlete' and u.coach_id = $1
          order by u.full_name asc
        `,
        [request.user.id]
      ),
      pool.query(
        `
          select w.id, w.user_id, w.name, w.start_date, w.distance_meters, w.moving_time_seconds,
                 w.average_heartrate, w.average_speed, u.full_name as athlete_name
          from workouts w
          join users u on u.id = w.user_id
          where u.coach_id = $1
          order by w.start_date desc
          limit 20
        `,
        [request.user.id]
      )
    ]);

    return {
      athletes: athletesResult.rows,
      recentWorkouts: workoutsResult.rows
    };
  });

  app.get("/api/trainer/athletes/:id", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["trainer"]);
    const params = request.params as { id: string };
    const athleteId = Number(params.id);
    const query = workoutCursorQuerySchema.parse(request.query);
    if (hasPartialCursor(query)) {
      return reply.code(400).send({ message: "Invalid workout cursor" });
    }
    const beforeDate = query.beforeDate ?? null;
    const beforeId = query.beforeId ?? null;
    const hasCursor = beforeDate !== null && beforeId !== null;

    const athleteResult = await pool.query(
      `select id, full_name, username, avatar_url from users where id = $1 and coach_id = $2 and role = 'athlete'`,
      [athleteId, request.user.id]
    );

    if (!athleteResult.rows[0]) {
      return reply.code(404).send({ message: "Спортсмен не найден" });
    }

    const workoutsResult = hasCursor
      ? await pool.query(
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
          [athleteId, beforeDate, beforeId, ATHLETE_WORKOUTS_PAGE_SIZE]
        )
      : await pool.query(
          `
            select id, name, sport_type, start_date, distance_meters, moving_time_seconds,
                   elevation_gain, average_speed, average_heartrate
            from workouts
            where user_id = $1
            order by start_date desc, id desc
            limit $2
          `,
          [athleteId, ATHLETE_WORKOUTS_PAGE_SIZE]
        );

    const workouts = workoutsResult.rows;
    return {
      athlete: athleteResult.rows[0],
      workouts,
      nextCursor: buildNextCursor(workouts as Array<{ id: number; start_date: string }>, ATHLETE_WORKOUTS_PAGE_SIZE)
    };
  });

  app.get("/api/trainer/workouts/:id", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["trainer"]);
    const params = request.params as { id: string };
    const workoutId = Number(params.id);

    const workoutResult = await pool.query(
      `
        select w.*, u.full_name as athlete_name, u.id as athlete_id
        from workouts w
        join users u on u.id = w.user_id
        where w.id = $1 and u.coach_id = $2
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

    const streams = await ensureActivityStreams(
      workoutResult.rows[0].user_id as number,
      workoutId,
      workoutResult.rows[0].strava_activity_id as number
    );

    return {
      workout: workoutResult.rows[0],
      laps: lapsResult.rows,
      streams
    };
  });

  app.delete("/api/trainer/workouts/:id", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["trainer"]);
    const params = request.params as { id: string };
    const workoutId = Number(params.id);

    const { rowCount } = await pool.query(
      `
        delete from workouts w
        using users u
        where w.id = $1
          and w.user_id = u.id
          and u.coach_id = $2
      `,
      [workoutId, request.user.id]
    );

    if (rowCount === 0) {
      return reply.code(404).send({ message: "Тренировка не найдена" });
    }

    return { ok: true };
  });

  app.put("/api/trainer/workouts/:id/comment", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["trainer"]);
    const params = request.params as { id: string };
    const body = request.body as { coachComment?: unknown };
    const workoutId = Number(params.id);
    const coachComment =
      typeof body?.coachComment === "string" ? body.coachComment.trim().slice(0, 4000) : "";

    const result = await pool.query(
      `
        update workouts w
        set coach_comment = $3
        from users u
        where w.id = $1
          and w.user_id = u.id
          and u.coach_id = $2
        returning w.coach_comment
      `,
      [workoutId, request.user.id, coachComment || null]
    );

    if (!result.rows[0]) {
      return reply.code(404).send({ message: "РўСЂРµРЅРёСЂРѕРІРєР° РЅРµ РЅР°Р№РґРµРЅР°" });
    }

    return { ok: true, coachComment: result.rows[0].coach_comment ?? null };
  });
}
