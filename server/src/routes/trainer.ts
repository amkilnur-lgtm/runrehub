import { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireAuth, requireRole } from "../lib/auth.js";
import { pool } from "../lib/db.js";
import { buildNextCursor, hasPartialCursor } from "../lib/pagination.js";
import { ensureActivityStreams } from "../lib/strava.js";
import {
  applyWorkoutCorrectionToView,
  buildManualDistancePreview,
  buildManualTimePreview,
  buildGpsFixPreview,
  deleteWorkoutCorrection,
  getActiveWorkoutCorrection,
  upsertWorkoutCorrection
} from "../lib/workout-gps-fix.js";

const workoutCursorQuerySchema = z.object({
  beforeDate: z.string().datetime().optional(),
  beforeId: z.coerce.number().int().positive().optional()
});

const workoutRenameSchema = z.object({
  name: z.string().trim().min(1)
});

const workoutDistanceFixSchema = z.object({
  distanceKm: z.coerce.number().positive().max(500)
});

const workoutTimeFixSchema = z.object({
  movingTimeSeconds: z.coerce.number().int().positive().max(60 * 60 * 24)
});

const ATHLETE_WORKOUTS_PAGE_SIZE = 20;

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

type TrainerDashboardStatsRow = {
  week_active_athlete_count: number | string | null;
  week_distance_meters: number | string | null;
  week_moving_time_seconds: number | string | null;
  week_workout_count: number | string | null;
  month_active_athlete_count: number | string | null;
  month_distance_meters: number | string | null;
  month_moving_time_seconds: number | string | null;
  month_workout_count: number | string | null;
  year_active_athlete_count: number | string | null;
  year_distance_meters: number | string | null;
  year_moving_time_seconds: number | string | null;
  year_workout_count: number | string | null;
  all_time_active_athlete_count: number | string | null;
  all_time_distance_meters: number | string | null;
  all_time_moving_time_seconds: number | string | null;
  all_time_workout_count: number | string | null;
};

export async function trainerRoutes(app: FastifyInstance) {
  // Оба запроса независимы — запускаем параллельно через Promise.all
  app.get("/api/trainer/dashboard", { preHandler: requireAuth }, async (request) => {
    requireRole(request, ["trainer"]);

    const [athletesResult, workoutsResult, summaryResult, connectedResult, leadersResult] = await Promise.all([
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
          select
            w.id,
            w.user_id,
            w.name,
            w.start_date,
            coalesce(wc.corrected_distance_meters, w.distance_meters) as distance_meters,
            coalesce(wc.corrected_moving_time_seconds, w.moving_time_seconds) as moving_time_seconds,
            coalesce(wc.corrected_average_heartrate, w.average_heartrate) as average_heartrate,
            coalesce(wc.corrected_average_speed, w.average_speed) as average_speed,
            u.full_name as athlete_name
          from workouts w
          join users u on u.id = w.user_id
          left join workout_corrections wc on wc.workout_id = w.id
          where u.coach_id = $1
          order by w.start_date desc
          limit 20
        `,
        [request.user.id]
      ),
      pool.query<TrainerDashboardStatsRow>(
        `
          select
            count(distinct u.id) filter (where w.start_date >= date_trunc('week', now())) as week_active_athlete_count,
            coalesce(sum(coalesce(wc.corrected_distance_meters, w.distance_meters)) filter (where w.start_date >= date_trunc('week', now())), 0) as week_distance_meters,
            coalesce(sum(coalesce(wc.corrected_moving_time_seconds, w.moving_time_seconds)) filter (where w.start_date >= date_trunc('week', now())), 0) as week_moving_time_seconds,
            count(w.id) filter (where w.start_date >= date_trunc('week', now())) as week_workout_count,
            count(distinct u.id) filter (where w.start_date >= date_trunc('month', now())) as month_active_athlete_count,
            coalesce(sum(coalesce(wc.corrected_distance_meters, w.distance_meters)) filter (where w.start_date >= date_trunc('month', now())), 0) as month_distance_meters,
            coalesce(sum(coalesce(wc.corrected_moving_time_seconds, w.moving_time_seconds)) filter (where w.start_date >= date_trunc('month', now())), 0) as month_moving_time_seconds,
            count(w.id) filter (where w.start_date >= date_trunc('month', now())) as month_workout_count,
            count(distinct u.id) filter (where w.start_date >= date_trunc('year', now())) as year_active_athlete_count,
            coalesce(sum(coalesce(wc.corrected_distance_meters, w.distance_meters)) filter (where w.start_date >= date_trunc('year', now())), 0) as year_distance_meters,
            coalesce(sum(coalesce(wc.corrected_moving_time_seconds, w.moving_time_seconds)) filter (where w.start_date >= date_trunc('year', now())), 0) as year_moving_time_seconds,
            count(w.id) filter (where w.start_date >= date_trunc('year', now())) as year_workout_count,
            count(distinct u.id) filter (where w.id is not null) as all_time_active_athlete_count,
            coalesce(sum(coalesce(wc.corrected_distance_meters, w.distance_meters)), 0) as all_time_distance_meters,
            coalesce(sum(coalesce(wc.corrected_moving_time_seconds, w.moving_time_seconds)), 0) as all_time_moving_time_seconds,
            count(w.id) as all_time_workout_count
          from users u
          left join workouts w on w.user_id = u.id
          left join workout_corrections wc on wc.workout_id = w.id
          where u.role = 'athlete' and u.coach_id = $1
        `,
        [request.user.id]
      ),
      pool.query(
        `
          select count(*) as connected_count
          from users u
          join strava_connections sc on sc.user_id = u.id
          where u.role = 'athlete' and u.coach_id = $1
        `,
        [request.user.id]
      ),
      pool.query(
        `
          select
            u.id,
            u.full_name,
            u.username,
            u.avatar_url,
            coalesce(sum(coalesce(wc.corrected_distance_meters, w.distance_meters)), 0) as week_distance_meters,
            count(w.id) as week_workout_count
          from users u
          left join workouts w
            on w.user_id = u.id
           and w.start_date >= date_trunc('week', now())
          left join workout_corrections wc on wc.workout_id = w.id
          where u.role = 'athlete' and u.coach_id = $1
          group by u.id, u.full_name, u.username, u.avatar_url
          order by week_distance_meters desc, week_workout_count desc, u.full_name asc
          limit 3
        `,
        [request.user.id]
      )
    ]);

    const summary = summaryResult.rows[0];

    return {
      athletes: athletesResult.rows,
      recentWorkouts: workoutsResult.rows,
      connectedAthletesCount: Number(connectedResult.rows[0]?.connected_count ?? 0),
      stats: {
        week: {
          athlete_count: athletesResult.rows.length,
          active_athlete_count: Number(summary?.week_active_athlete_count ?? 0),
          workout_count: Number(summary?.week_workout_count ?? 0),
          distance_meters: Number(summary?.week_distance_meters ?? 0),
          moving_time_seconds: Number(summary?.week_moving_time_seconds ?? 0)
        },
        month: {
          athlete_count: athletesResult.rows.length,
          active_athlete_count: Number(summary?.month_active_athlete_count ?? 0),
          workout_count: Number(summary?.month_workout_count ?? 0),
          distance_meters: Number(summary?.month_distance_meters ?? 0),
          moving_time_seconds: Number(summary?.month_moving_time_seconds ?? 0)
        },
        year: {
          athlete_count: athletesResult.rows.length,
          active_athlete_count: Number(summary?.year_active_athlete_count ?? 0),
          workout_count: Number(summary?.year_workout_count ?? 0),
          distance_meters: Number(summary?.year_distance_meters ?? 0),
          moving_time_seconds: Number(summary?.year_moving_time_seconds ?? 0)
        },
        allTime: {
          athlete_count: athletesResult.rows.length,
          active_athlete_count: Number(summary?.all_time_active_athlete_count ?? 0),
          workout_count: Number(summary?.all_time_workout_count ?? 0),
          distance_meters: Number(summary?.all_time_distance_meters ?? 0),
          moving_time_seconds: Number(summary?.all_time_moving_time_seconds ?? 0)
        }
      },
      topAthletesThisWeek: leadersResult.rows.map((row) => ({
        id: Number(row.id),
        full_name: row.full_name,
        username: row.username,
        avatar_url: row.avatar_url,
        week_distance_meters: Number(row.week_distance_meters ?? 0),
        week_workout_count: Number(row.week_workout_count ?? 0)
      }))
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
      `
        select
          u.id,
          u.full_name,
          u.username,
          u.avatar_url,
          sc.connected_at,
          sc.last_synced_at
        from users u
        left join strava_connections sc on sc.user_id = u.id
        where u.id = $1 and u.coach_id = $2 and u.role = 'athlete'
      `,
      [athleteId, request.user.id]
    );

    if (!athleteResult.rows[0]) {
      return reply.code(404).send({ message: "Спортсмен не найден" });
    }

    const [workoutsResult, statsResult] = await Promise.all([
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
            [athleteId, beforeDate, beforeId, ATHLETE_WORKOUTS_PAGE_SIZE]
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
            [athleteId, ATHLETE_WORKOUTS_PAGE_SIZE]
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
        [athleteId]
      )
    ]);

    const workouts = workoutsResult.rows;
    const stats = statsResult.rows[0];
    return {
      athlete: athleteResult.rows[0],
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

    const correction = await getActiveWorkoutCorrection(workoutId);
    const correctedView = applyWorkoutCorrectionToView(
      workoutResult.rows[0],
      lapsResult.rows,
      streams,
      correction
    );

    return correctedView;
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

  app.put("/api/trainer/workouts/:id/name", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["trainer"]);
    const params = request.params as { id: string };
    const body = workoutRenameSchema.parse(request.body);
    const workoutId = Number(params.id);

    const result = await pool.query(
      `
        update workouts w
        set name = $3,
            custom_name = $3
        from users u
        where w.id = $1
          and w.user_id = u.id
          and u.coach_id = $2
        returning w.name
      `,
      [workoutId, request.user.id, body.name]
    );

    if (!result.rows[0]) {
      return reply.code(404).send({ message: "Тренировка не найдена" });
    }

    return { ok: true, name: result.rows[0].name };
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

  app.post("/api/trainer/workouts/:id/gps-fix/preview", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["trainer"]);
    const params = request.params as { id: string };
    const workoutId = Number(params.id);

    const workoutResult = await pool.query(
      `
        select w.*
        from workouts w
        join users u on u.id = w.user_id
        where w.id = $1 and u.coach_id = $2
      `,
      [workoutId, request.user.id]
    );

    const workout = workoutResult.rows[0];
    if (!workout) {
      return reply.code(404).send({ message: "Тренировка не найдена" });
    }

    const lapsResult = await pool.query(
      `select * from workout_laps where workout_id = $1 order by id asc`,
      [workoutId]
    );
    const streams = await ensureActivityStreams(
      workout.user_id as number,
      workoutId,
      workout.strava_activity_id as number
    );

    const preview = buildGpsFixPreview(workout, lapsResult.rows, streams);
    if (!preview) {
      return reply.code(400).send({ message: "Явных GPS-скачков не найдено" });
    }

    return {
      ok: true,
      preview: {
        removedSegments: preview.removedSegments,
        before: {
          distance_meters: workout.distance_meters,
          moving_time_seconds: workout.moving_time_seconds,
          average_speed: workout.average_speed,
          elevation_gain: workout.elevation_gain
        },
        after: preview.correctedWorkout
      }
    };
  });

  app.post("/api/trainer/workouts/:id/gps-fix/apply", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["trainer"]);
    const params = request.params as { id: string };
    const workoutId = Number(params.id);

    const workoutResult = await pool.query(
      `
        select w.*
        from workouts w
        join users u on u.id = w.user_id
        where w.id = $1 and u.coach_id = $2
      `,
      [workoutId, request.user.id]
    );

    const workout = workoutResult.rows[0];
    if (!workout) {
      return reply.code(404).send({ message: "Тренировка не найдена" });
    }

    const lapsResult = await pool.query(
      `select * from workout_laps where workout_id = $1 order by id asc`,
      [workoutId]
    );
    const streams = await ensureActivityStreams(
      workout.user_id as number,
      workoutId,
      workout.strava_activity_id as number
    );

    const preview = buildGpsFixPreview(workout, lapsResult.rows, streams);
    if (!preview) {
      return reply.code(400).send({ message: "Явных GPS-скачков не найдено" });
    }

    await upsertWorkoutCorrection(workoutId, request.user.id, "gps_autofix", preview);
    const correction = await getActiveWorkoutCorrection(workoutId);
    const correctedView = applyWorkoutCorrectionToView(workout, lapsResult.rows, streams, correction);

    return {
      ok: true,
      workout: correctedView.workout,
      laps: correctedView.laps,
      streams: correctedView.streams
    };
  });

  app.delete("/api/trainer/workouts/:id/gps-fix", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["trainer"]);
    const params = request.params as { id: string };
    const workoutId = Number(params.id);

    const ownershipResult = await pool.query(
      `
        select w.id
        from workouts w
        join users u on u.id = w.user_id
        where w.id = $1 and u.coach_id = $2
      `,
      [workoutId, request.user.id]
    );

    if (!ownershipResult.rows[0]) {
      return reply.code(404).send({ message: "Тренировка не найдена" });
    }

    await deleteWorkoutCorrection(workoutId);
    return { ok: true };
  });

  app.post("/api/trainer/workouts/:id/distance-fix/preview", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["trainer"]);
    const params = request.params as { id: string };
    const body = workoutDistanceFixSchema.parse(request.body);
    const workoutId = Number(params.id);

    const workoutResult = await pool.query(
      `
        select w.*
        from workouts w
        join users u on u.id = w.user_id
        where w.id = $1 and u.coach_id = $2
      `,
      [workoutId, request.user.id]
    );

    const workout = workoutResult.rows[0];
    if (!workout) {
      return reply.code(404).send({ message: "РўСЂРµРЅРёСЂРѕРІРєР° РЅРµ РЅР°Р№РґРµРЅР°" });
    }

    const lapsResult = await pool.query(
      `select * from workout_laps where workout_id = $1 order by id asc`,
      [workoutId]
    );
    const streams = await ensureActivityStreams(
      workout.user_id as number,
      workoutId,
      workout.strava_activity_id as number
    );
    const correction = await getActiveWorkoutCorrection(workoutId);
    const correctedView = applyWorkoutCorrectionToView(workout, lapsResult.rows, streams, correction);
    const currentWorkout = correctedView.workout as typeof workout & {
      distance_meters: number;
      moving_time_seconds: number;
      elapsed_time_seconds: number;
      elevation_gain: number;
      average_speed: number | null;
      average_heartrate: number | null;
      max_heartrate: number | null;
    };

    const preview = buildManualDistancePreview(
      currentWorkout,
      correctedView.streams,
      Math.round(body.distanceKm * 1000)
    );
    if (!preview) {
      return reply.code(400).send({ message: "РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕСЃС‚СЂРѕРёС‚СЊ РїСЂРµРґРїСЂРѕСЃРјРѕС‚СЂ РґР»СЏ РЅРѕРІРѕР№ РґРёСЃС‚Р°РЅС†РёРё" });
    }

    return {
      ok: true,
      preview: {
        before: {
          distance_meters: currentWorkout.distance_meters,
          moving_time_seconds: currentWorkout.moving_time_seconds,
          average_speed: currentWorkout.average_speed,
          elevation_gain: currentWorkout.elevation_gain
        },
        after: preview.correctedWorkout,
        splitCount: preview.correctedLaps.length
      }
    };
  });

  app.post("/api/trainer/workouts/:id/distance-fix/apply", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["trainer"]);
    const params = request.params as { id: string };
    const body = workoutDistanceFixSchema.parse(request.body);
    const workoutId = Number(params.id);

    const workoutResult = await pool.query(
      `
        select w.*
        from workouts w
        join users u on u.id = w.user_id
        where w.id = $1 and u.coach_id = $2
      `,
      [workoutId, request.user.id]
    );

    const workout = workoutResult.rows[0];
    if (!workout) {
      return reply.code(404).send({ message: "РўСЂРµРЅРёСЂРѕРІРєР° РЅРµ РЅР°Р№РґРµРЅР°" });
    }

    const lapsResult = await pool.query(
      `select * from workout_laps where workout_id = $1 order by id asc`,
      [workoutId]
    );
    const streams = await ensureActivityStreams(
      workout.user_id as number,
      workoutId,
      workout.strava_activity_id as number
    );
    const correction = await getActiveWorkoutCorrection(workoutId);
    const correctedView = applyWorkoutCorrectionToView(workout, lapsResult.rows, streams, correction);
    const currentWorkout = correctedView.workout as typeof workout & {
      distance_meters: number;
      moving_time_seconds: number;
      elapsed_time_seconds: number;
      elevation_gain: number;
      average_speed: number | null;
      average_heartrate: number | null;
      max_heartrate: number | null;
    };

    const preview = buildManualDistancePreview(
      currentWorkout,
      correctedView.streams,
      Math.round(body.distanceKm * 1000)
    );
    if (!preview) {
      return reply.code(400).send({ message: "РќРµ СѓРґР°Р»РѕСЃСЊ РїСЂРёРјРµРЅРёС‚СЊ РЅРѕРІСѓСЋ РґРёСЃС‚Р°РЅС†РёСЋ" });
    }

    await upsertWorkoutCorrection(workoutId, request.user.id, "manual_distance", preview);
    const updatedCorrection = await getActiveWorkoutCorrection(workoutId);
    const finalView = applyWorkoutCorrectionToView(workout, lapsResult.rows, streams, updatedCorrection);

    return {
      ok: true,
      workout: finalView.workout,
      laps: finalView.laps,
      streams: finalView.streams
    };
  });

  app.post("/api/trainer/workouts/:id/time-fix/preview", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["trainer"]);
    const params = request.params as { id: string };
    const body = workoutTimeFixSchema.parse(request.body);
    const workoutId = Number(params.id);

    const workoutResult = await pool.query(
      `
        select w.*
        from workouts w
        join users u on u.id = w.user_id
        where w.id = $1 and u.coach_id = $2
      `,
      [workoutId, request.user.id]
    );

    const workout = workoutResult.rows[0];
    if (!workout) {
      return reply.code(404).send({ message: "РўСЂРµРЅРёСЂРѕРІРєР° РЅРµ РЅР°Р№РґРµРЅР°" });
    }

    const lapsResult = await pool.query(
      `select * from workout_laps where workout_id = $1 order by id asc`,
      [workoutId]
    );
    const streams = await ensureActivityStreams(
      workout.user_id as number,
      workoutId,
      workout.strava_activity_id as number
    );
    const correction = await getActiveWorkoutCorrection(workoutId);
    const correctedView = applyWorkoutCorrectionToView(workout, lapsResult.rows, streams, correction);
    const currentWorkout = correctedView.workout as typeof workout & {
      distance_meters: number;
      moving_time_seconds: number;
      elapsed_time_seconds: number;
      elevation_gain: number;
      average_speed: number | null;
      average_heartrate: number | null;
      max_heartrate: number | null;
    };

    const preview = buildManualTimePreview(
      currentWorkout,
      correctedView.streams,
      body.movingTimeSeconds
    );
    if (!preview) {
      return reply.code(400).send({ message: "РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕСЃС‚СЂРѕРёС‚СЊ РїСЂРµРґРїСЂРѕСЃРјРѕС‚СЂ РґР»СЏ РЅРѕРІРѕРіРѕ РІСЂРµРјРµРЅРё" });
    }

    return {
      ok: true,
      preview: {
        before: {
          distance_meters: currentWorkout.distance_meters,
          moving_time_seconds: currentWorkout.moving_time_seconds,
          average_speed: currentWorkout.average_speed,
          elevation_gain: currentWorkout.elevation_gain
        },
        after: preview.correctedWorkout,
        splitCount: preview.correctedLaps.length
      }
    };
  });

  app.post("/api/trainer/workouts/:id/time-fix/apply", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["trainer"]);
    const params = request.params as { id: string };
    const body = workoutTimeFixSchema.parse(request.body);
    const workoutId = Number(params.id);

    const workoutResult = await pool.query(
      `
        select w.*
        from workouts w
        join users u on u.id = w.user_id
        where w.id = $1 and u.coach_id = $2
      `,
      [workoutId, request.user.id]
    );

    const workout = workoutResult.rows[0];
    if (!workout) {
      return reply.code(404).send({ message: "РўСЂРµРЅРёСЂРѕРІРєР° РЅРµ РЅР°Р№РґРµРЅР°" });
    }

    const lapsResult = await pool.query(
      `select * from workout_laps where workout_id = $1 order by id asc`,
      [workoutId]
    );
    const streams = await ensureActivityStreams(
      workout.user_id as number,
      workoutId,
      workout.strava_activity_id as number
    );
    const correction = await getActiveWorkoutCorrection(workoutId);
    const correctedView = applyWorkoutCorrectionToView(workout, lapsResult.rows, streams, correction);
    const currentWorkout = correctedView.workout as typeof workout & {
      distance_meters: number;
      moving_time_seconds: number;
      elapsed_time_seconds: number;
      elevation_gain: number;
      average_speed: number | null;
      average_heartrate: number | null;
      max_heartrate: number | null;
    };

    const preview = buildManualTimePreview(
      currentWorkout,
      correctedView.streams,
      body.movingTimeSeconds
    );
    if (!preview) {
      return reply.code(400).send({ message: "РќРµ СѓРґР°Р»РѕСЃСЊ РїСЂРёРјРµРЅРёС‚СЊ РЅРѕРІРѕРµ РІСЂРµРјСЏ" });
    }

    await upsertWorkoutCorrection(workoutId, request.user.id, "manual_time", preview);
    const updatedCorrection = await getActiveWorkoutCorrection(workoutId);
    const finalView = applyWorkoutCorrectionToView(workout, lapsResult.rows, streams, updatedCorrection);

    return {
      ok: true,
      workout: finalView.workout,
      laps: finalView.laps,
      streams: finalView.streams
    };
  });
}
