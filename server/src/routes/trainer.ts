import { FastifyInstance } from "fastify";
import { z } from "zod";
import { getClub } from "../lib/club.js";
import { getHealth } from "../lib/health.js";
import { birthdaySchema } from "./auth.js";

import { getAthleteTrends } from "../lib/athlete-trends.js";
import { requireAuth, requireRole } from "../lib/auth.js";
import { buildStoryCardPng } from "../lib/telegram-notifications.js";
import { signStoryLink } from "../lib/story-links.js";
import { pool } from "../lib/db.js";
import { getWorkoutFeeling } from "../lib/workout-feeling.js";
import { getGroupHeatmap, type HeatmapLevel } from "../lib/group-heatmap.js";
import { getAthleteCycles, getAthleteState, type CycleLevel } from "../lib/athlete-cycles.js";
import { getThreshold } from "../lib/pace-zones.js";
import { getWeeklyVolume, HAS_COACH_FEEDBACK_SQL } from "../lib/weekly-volume.js";
import { getGroupRecentResults, getGroupUpcomingStarts } from "../lib/race-results.js";
import {
  addWorkoutComment,
  getTrainerFeed,
  getWorkoutLikers,
  getWorkoutLikeState,
  listWorkoutComments
} from "../lib/social.js";
import { buildNextCursor, hasPartialCursor } from "../lib/pagination.js";
import { getStoredActivityStreams, markWorkoutDeleted } from "../lib/strava.js";
import { analyzeWorkout } from "../lib/workout-analysis.js";
import {
  applyWorkoutCorrectionToView,
  buildAthleteCadenceProfile,
  buildManualDistancePreview,
  buildManualTimePreview,
  buildGpsFixPreview,
  buildTrimPreview,
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

const workoutTrimSchema = z.object({
  startKm: z.coerce.number().min(0).max(500),
  endKm: z.coerce.number().positive().max(500)
});

const workoutCommentSchema = z.object({
  body: z.string().trim().min(1).max(1000),
  channel: z.enum(["coach", "club"]).default("club")
});
const commentChannelQuery = z.object({ channel: z.enum(["coach", "club"]).default("club") });

// Тренировка принадлежит атлету этого тренера
async function trainerOwnsWorkout(trainerId: number, workoutId: number) {
  const { rows } = await pool.query(
    `select 1 from workouts w join users u on u.id = w.user_id where w.id = $1 and u.coach_id = $2 limit 1`,
    [workoutId, trainerId]
  );
  return rows.length > 0;
}

const ATHLETE_WORKOUTS_PAGE_SIZE = 20;

function scheduleWorkoutAnalysis(workoutId: number) {
  void analyzeWorkout(workoutId).catch(() => undefined);
}

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
  // Картинка 1080×1920 для сторис (кнопка «Поделиться»). Рендер тяжёлый — ограничиваем частоту
  app.get(
    "/api/trainer/workouts/:id/story.png",
    { preHandler: requireAuth, config: { rateLimit: { max: 12, timeWindow: "1 minute" } } },
    async (request, reply) => {
      requireRole(request, ["trainer"]);
      const workoutId = Number((request.params as { id: string }).id);
      if (!Number.isSafeInteger(workoutId)) {
        return reply.code(404).send({ message: "Тренировка не найдена" });
      }
      const { rows } = await pool.query(
        `select u.full_name from workouts w join users u on u.id = w.user_id where w.id = $1 and u.coach_id = $2`,
        [workoutId, request.user.id]
      );
      if (!rows[0]) {
        return reply.code(404).send({ message: "Тренировка не найдена" });
      }
      const png = await buildStoryCardPng(workoutId, rows[0].full_name as string);
      return reply
        .header("Content-Type", "image/png")
        .header("Cache-Control", "private, max-age=300")
        .send(png);
    }
  );

  // Временная публичная ссылка на ту же картинку: Telegram (shareToStory) скачивает
  // её сам, без наших кук. Подпись JWT, живёт 15 минут
  app.get("/api/trainer/workouts/:id/story-link", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["trainer"]);
    const workoutId = Number((request.params as { id: string }).id);
    const { rows } = await pool.query(
      `select 1 from workouts w join users u on u.id = w.user_id where w.id = $1 and u.coach_id = $2`,
      [Number.isSafeInteger(workoutId) ? workoutId : 0, request.user.id]
    );
    if (!rows[0]) {
      return reply.code(404).send({ message: "Тренировка не найдена" });
    }
    return { url: await signStoryLink(reply, workoutId) };
  });

  // Оба запроса независимы — запускаем параллельно через Promise.all
  // Очередь «Разбор»: пробежки этой недели без отзыва тренера, от старых к новым
  // Очередь «Разбор»: пробежки этой недели без отзыва тренера, от старых к новым,
  // и пробежки за 14 дней, где последнее слово в обсуждении за спортсменом
  app.get("/api/trainer/club", { preHandler: requireAuth }, async (request) => {
    requireRole(request, ["trainer"]);
    return getClub(request.user.id, request.user.id, true);
  });

  app.put("/api/trainer/athletes/:id/birthday", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["trainer"]);
    const athleteId = Number((request.params as { id: string }).id);
    const body = birthdaySchema.parse(request.body);
    const { rowCount } = await pool.query(
      `update users set birthday_day = $3, birthday_month = $4, birthday_hidden = $5
       where id = $1 and coach_id = $2 and role = 'athlete'`,
      [athleteId, request.user.id, body.day, body.month, body.hidden]
    );
    if (!rowCount) return reply.code(404).send({ message: "Спортсмен не найден" });
    return { ok: true, ...body };
  });

  // «Здоровье» спортсмена — только если он дал согласие и не закрыл раздел от тренера
  app.get("/api/trainer/athletes/:id/health", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["trainer"]);
    const athleteId = Number((request.params as { id: string }).id);
    const { rows } = await pool.query(
      `select health_consent_at, health_share_coach from users where id = $1 and coach_id = $2 and role = 'athlete'`,
      [athleteId, request.user.id]
    );
    if (!rows[0]) return reply.code(404).send({ message: "Спортсмен не найден" });
    if (!rows[0].health_consent_at) return { shared: false };
    const health = await getHealth(athleteId);
    // цикл — отдельным разрешением, даже если анализы тренеру закрыты
    const cycle =
      health.cycle.enabled && health.cycle.share_coach
        ? { day: health.cycle.day, avg_length: health.cycle.avg_length, next_in_days: health.cycle.next_in_days, alert: health.cycle.alert }
        : null;
    if (!rows[0].health_share_coach) return cycle ? { shared: true, labs: [], supplements: [], cycle } : { shared: false };
    return { shared: true, labs: health.labs, supplements: health.supplements.filter((item) => !item.stopped_on), cycle };
  });

  app.get("/api/trainer/review-queue", { preHandler: requireAuth }, async (request) => {
    requireRole(request, ["trainer"]);
    const [pending, replied] = await Promise.all([
      pool.query(
        `
          select w.id, w.start_date,
                 exists (select 1 from workout_feelings f where f.workout_id = w.id and f.pain = 'light') as has_pain
          from workouts w
          join users u on u.id = w.user_id
          where u.role = 'athlete' and u.coach_id = $1
            and w.start_date >= date_trunc('week', now())
            and not ${HAS_COACH_FEEDBACK_SQL}
        `,
        [request.user.id]
      ),
      pool.query(
        `
          select w.id, last.created_at, last.body
          from workouts w
          join users u on u.id = w.user_id
          join lateral (
            select c.author_id, c.created_at, c.body from workout_comments c
            where c.workout_id = w.id and c.is_private order by c.created_at desc, c.id desc limit 1
          ) last on true
          where u.role = 'athlete' and u.coach_id = $1
            and last.author_id = w.user_id
            and last.created_at >= now() - interval '14 days'
            and last.created_at > coalesce(w.coach_comment_updated_at, '-infinity'::timestamptz)
        `,
        [request.user.id]
      )
    ]);
    const repliedIds = replied.rows.map((row) => Number(row.id));
    const pendingIds = pending.rows
      // пробежки с болью — первыми (отчёт «Страница тренера и клуба»), дальше от старых к новым
      .sort((a, b) => Number(b.has_pain) - Number(a.has_pain) || new Date(a.start_date).getTime() - new Date(b.start_date).getTime())
      .map((row) => Number(row.id))
      .filter((id) => !repliedIds.includes(id));
    // ответы спортсменов — первыми: на них ждут ответа
    return {
      workoutIds: [...repliedIds, ...pendingIds],
      replies: replied.rows.map((row) => ({ workoutId: Number(row.id), body: String(row.body), created_at: row.created_at }))
    };
  });

  app.get("/api/trainer/starts", { preHandler: requireAuth }, async (request) => {
    requireRole(request, ["trainer"]);
    const [upcoming, recent] = await Promise.all([
      getGroupUpcomingStarts(request.user.id, 180),
      getGroupRecentResults(request.user.id)
    ]);
    return { upcoming, recent };
  });

  // Карточка спортсмена: циклы, состояние, заметки. Только спортсмен своей группы
  async function ownsAthlete(coachId: number, athleteId: number) {
    const { rows } = await pool.query(`select 1 from users where id = $1 and coach_id = $2 and role = 'athlete'`, [athleteId, coachId]);
    return Boolean(rows[0]);
  }

  app.get("/api/trainer/athletes/:id/cycles", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["trainer"]);
    const athleteId = Number((request.params as { id: string }).id);
    if (!(await ownsAthlete(request.user.id, athleteId))) return reply.code(404).send({ message: "Спортсмен не найден" });
    const level = String((request.query as { level?: string }).level ?? "week");
    return getAthleteCycles(athleteId, (["week", "blocks", "season"] as string[]).includes(level) ? (level as CycleLevel) : "week");
  });

  app.get("/api/trainer/athletes/:id/state", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["trainer"]);
    const athleteId = Number((request.params as { id: string }).id);
    if (!(await ownsAthlete(request.user.id, athleteId))) return reply.code(404).send({ message: "Спортсмен не найден" });
    const [state, note] = await Promise.all([
      getAthleteState(athleteId),
      pool.query(`select body, updated_at from coach_notes where athlete_id = $1 and coach_id = $2`, [athleteId, request.user.id])
    ]);
    return { ...state, note: note.rows[0]?.body ?? "", note_updated_at: note.rows[0]?.updated_at ?? null };
  });

  // Пороговый темп: сек/км или null — сбросить к оценке по старту
  app.put("/api/trainer/athletes/:id/threshold", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["trainer"]);
    const athleteId = Number((request.params as { id: string }).id);
    if (!(await ownsAthlete(request.user.id, athleteId))) return reply.code(404).send({ message: "Спортсмен не найден" });
    const { pace } = z.object({ pace: z.number().int().min(150).max(600).nullable() }).parse(request.body);
    if (pace === null) {
      await pool.query(`delete from athlete_thresholds where athlete_id = $1`, [athleteId]);
    } else {
      await pool.query(
        `insert into athlete_thresholds (athlete_id, pace_seconds_per_km, updated_by) values ($1, $2, $3)
         on conflict (athlete_id) do update set pace_seconds_per_km = excluded.pace_seconds_per_km,
           updated_by = excluded.updated_by, updated_at = now()`,
        [athleteId, pace, request.user.id]
      );
    }
    return { ok: true, threshold: await getThreshold(athleteId) };
  });

  app.put("/api/trainer/athletes/:id/note", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["trainer"]);
    const athleteId = Number((request.params as { id: string }).id);
    if (!(await ownsAthlete(request.user.id, athleteId))) return reply.code(404).send({ message: "Спортсмен не найден" });
    const body = z.object({ body: z.string().max(4000) }).parse(request.body).body.trim();
    await pool.query(
      `insert into coach_notes (athlete_id, coach_id, body) values ($1, $2, $3)
       on conflict (athlete_id, coach_id) do update set body = excluded.body, updated_at = now()`,
      [athleteId, request.user.id, body]
    );
    return { ok: true, note: body };
  });

  app.get("/api/trainer/group-heatmap", { preHandler: requireAuth }, async (request) => {
    requireRole(request, ["trainer"]);
    const level = String((request.query as { level?: string }).level ?? "weeks");
    const allowed: HeatmapLevel[] = ["days", "weeks", "blocks", "months"];
    return getGroupHeatmap(request.user.id, (allowed as string[]).includes(level) ? (level as HeatmapLevel) : "weeks");
  });

  app.get("/api/trainer/dashboard", { preHandler: requireAuth }, async (request) => {
    requireRole(request, ["trainer"]);

    const [athletesResult, workoutsResult, summaryResult, connectedResult, leadersResult, pendingResult] = await Promise.all([
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
            u.full_name as athlete_name,
            u.avatar_url as athlete_avatar_url,
            ${HAS_COACH_FEEDBACK_SQL} as has_feedback,
            (w.start_date >= date_trunc('week', now())) as is_this_week
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
          where u.role = 'athlete' and u.coach_id = $1
            and exists (select 1 from intervals_connections ic where ic.user_id = u.id)
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
      ),
      pool.query(
        `
          select count(*) as pending_count, min(w.start_date) as oldest_pending_at
          from workouts w
          join users u on u.id = w.user_id
          where u.role = 'athlete' and u.coach_id = $1
            and w.start_date >= date_trunc('week', now())
            and not ${HAS_COACH_FEEDBACK_SQL}
        `,
        [request.user.id]
      )
    ]);

    const [volume, upcomingStarts] = await Promise.all([
      getWeeklyVolume(athletesResult.rows.map((row) => Number(row.id))),
      getGroupUpcomingStarts(request.user.id)
    ]);

    const summary = summaryResult.rows[0];

    return {
      athletes: athletesResult.rows,
      recentWorkouts: workoutsResult.rows,
      connectedAthletesCount: Number(connectedResult.rows[0]?.connected_count ?? 0),
      feedback: {
        pendingCount: Number(pendingResult.rows[0]?.pending_count ?? 0),
        oldestPendingAt: pendingResult.rows[0]?.oldest_pending_at ?? null
      },
      upcomingStarts,
      groupWeeks: {
        weekStarts: volume.weekStarts,
        athletes: athletesResult.rows.map((row) => ({
          id: Number(row.id),
          distances: volume.byUser.get(Number(row.id)) ?? []
        }))
      },
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

  app.get("/api/trainer/athletes/:id/trends", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["trainer"]);
    const params = request.params as { id: string };
    const athleteId = Number(params.id);
    const { rows } = await pool.query(
      `select id from users where id = $1 and coach_id = $2 and role = 'athlete'`,
      [athleteId, request.user.id]
    );
    if (!rows[0]) {
      return reply.code(404).send({ message: "Спортсмен не найден" });
    }
    return getAthleteTrends(athleteId);
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
          ic.connected_at as connected_at,
          ic.last_synced_at as last_synced_at,
          case when ic.user_id is not null then 'intervals' end as provider
        from users u
        left join intervals_connections ic on ic.user_id = u.id
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

    const streams = await getStoredActivityStreams(workoutId);

    const correction = await getActiveWorkoutCorrection(workoutId);
    const correctedView = applyWorkoutCorrectionToView(
      workoutResult.rows[0],
      lapsResult.rows,
      streams,
      correction
    );

    return { ...correctedView, feeling: await getWorkoutFeeling(workoutId) };
  });

  app.delete("/api/trainer/workouts/:id", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["trainer"]);
    const params = request.params as { id: string };
    const workoutId = Number(params.id);

    const existingWorkoutResult = await pool.query(
      `
        select w.user_id, w.source, w.source_activity_id, w.strava_activity_id
        from workouts w
        join users u on u.id = w.user_id
        where w.id = $1
          and u.coach_id = $2
      `,
      [workoutId, request.user.id]
    );
    const existingWorkout = existingWorkoutResult.rows[0];

    if (!existingWorkout) {
      return reply.code(404).send({ message: "Тренировка не найдена" });
    }

    await markWorkoutDeleted(existingWorkout);

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
        set coach_comment = $3, coach_comment_updated_at = now()
        from users u
        where w.id = $1
          and w.user_id = u.id
          and u.coach_id = $2
        returning w.coach_comment
      `,
      [workoutId, request.user.id, coachComment || null]
    );

    if (!result.rows[0]) {
      return reply.code(404).send({ message: "Тренировка не найдена" });
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
    const streams = await getStoredActivityStreams(workoutId);
    const athleteProfile = await buildAthleteCadenceProfile(workout.user_id as number, workoutId);

    const preview = buildGpsFixPreview(workout, lapsResult.rows, streams, athleteProfile);
    if (!preview) {
      return reply.code(400).send({ message: "Явных GPS-скачков не найдено" });
    }

    return {
      ok: true,
      preview: {
        removedSegments: preview.removedSegments,
        metadata: preview.metadata,
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
    const streams = await getStoredActivityStreams(workoutId);
    const athleteProfile = await buildAthleteCadenceProfile(workout.user_id as number, workoutId);

    const preview = buildGpsFixPreview(workout, lapsResult.rows, streams, athleteProfile);
    if (!preview) {
      return reply.code(400).send({ message: "Явных GPS-скачков не найдено" });
    }

    await upsertWorkoutCorrection(workoutId, request.user.id, "gps_autofix", preview);
    scheduleWorkoutAnalysis(workoutId);
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
    scheduleWorkoutAnalysis(workoutId);
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
      return reply.code(404).send({ message: "Тренировка не найдена" });
    }

    const lapsResult = await pool.query(
      `select * from workout_laps where workout_id = $1 order by id asc`,
      [workoutId]
    );
    const streams = await getStoredActivityStreams(workoutId);
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
      return reply.code(400).send({ message: "Не удалось построить предпросмотр для новой дистанции" });
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
      return reply.code(404).send({ message: "Тренировка не найдена" });
    }

    const lapsResult = await pool.query(
      `select * from workout_laps where workout_id = $1 order by id asc`,
      [workoutId]
    );
    const streams = await getStoredActivityStreams(workoutId);
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
      return reply.code(400).send({ message: "Не удалось применить новую дистанцию" });
    }

    await upsertWorkoutCorrection(workoutId, request.user.id, "manual_distance", preview);
    scheduleWorkoutAnalysis(workoutId);
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
      return reply.code(404).send({ message: "Тренировка не найдена" });
    }

    const lapsResult = await pool.query(
      `select * from workout_laps where workout_id = $1 order by id asc`,
      [workoutId]
    );
    const streams = await getStoredActivityStreams(workoutId);
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
      return reply.code(400).send({ message: "Не удалось построить предпросмотр для нового времени" });
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
      return reply.code(404).send({ message: "Тренировка не найдена" });
    }

    const lapsResult = await pool.query(
      `select * from workout_laps where workout_id = $1 order by id asc`,
      [workoutId]
    );
    const streams = await getStoredActivityStreams(workoutId);
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
      return reply.code(400).send({ message: "Не удалось применить новое время" });
    }

    await upsertWorkoutCorrection(workoutId, request.user.id, "manual_time", preview);
    scheduleWorkoutAnalysis(workoutId);
    const updatedCorrection = await getActiveWorkoutCorrection(workoutId);
    const finalView = applyWorkoutCorrectionToView(workout, lapsResult.rows, streams, updatedCorrection);

    return {
      ok: true,
      workout: finalView.workout,
      laps: finalView.laps,
      streams: finalView.streams
    };
  });

  app.post("/api/trainer/workouts/:id/trim/preview", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["trainer"]);
    const params = request.params as { id: string };
    const body = workoutTrimSchema.parse(request.body);
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
    const streams = await getStoredActivityStreams(workoutId);
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

    // Круги хранят индексы исходного стрима; gps-автофикс его переиндексирует,
    // поэтому поверх автофикса круги не переносим (там их и нет — только сплиты).
    const trimLaps = correction?.kind === "gps_autofix" ? [] : lapsResult.rows;
    const preview = buildTrimPreview(
      currentWorkout,
      trimLaps,
      correctedView.streams,
      Math.round(body.startKm * 1000),
      Math.round(body.endKm * 1000)
    );
    if (!preview) {
      return reply.code(400).send({ message: "Не удалось обрезать: проверь границы отрезка" });
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

  app.post("/api/trainer/workouts/:id/trim/apply", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["trainer"]);
    const params = request.params as { id: string };
    const body = workoutTrimSchema.parse(request.body);
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
    const streams = await getStoredActivityStreams(workoutId);
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

    const trimLaps = correction?.kind === "gps_autofix" ? [] : lapsResult.rows;
    const preview = buildTrimPreview(
      currentWorkout,
      trimLaps,
      correctedView.streams,
      Math.round(body.startKm * 1000),
      Math.round(body.endKm * 1000)
    );
    if (!preview) {
      return reply.code(400).send({ message: "Не удалось обрезать: проверь границы отрезка" });
    }

    await upsertWorkoutCorrection(workoutId, request.user.id, "trim", preview);
    scheduleWorkoutAnalysis(workoutId);
    const updatedCorrection = await getActiveWorkoutCorrection(workoutId);
    const finalView = applyWorkoutCorrectionToView(workout, lapsResult.rows, streams, updatedCorrection);

    return {
      ok: true,
      workout: finalView.workout,
      laps: finalView.laps,
      streams: finalView.streams
    };
  });

  // Лента команды для тренера — те же карточки, что у атлетов
  app.get("/api/trainer/feed", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["trainer"]);
    const query = workoutCursorQuerySchema.parse(request.query);
    if (hasPartialCursor(query)) {
      return reply.code(400).send({ message: "Invalid feed cursor" });
    }
    const cursor =
      query.beforeDate && query.beforeId
        ? { beforeDate: query.beforeDate, beforeId: query.beforeId }
        : null;
    return getTrainerFeed(request.user.id, cursor);
  });

  app.post("/api/trainer/workouts/:id/like", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["trainer"]);
    const workoutId = Number((request.params as { id: string }).id);
    if (!(await trainerOwnsWorkout(request.user.id, workoutId))) {
      return reply.code(404).send({ message: "Тренировка не найдена" });
    }
    await pool.query(
      `insert into workout_likes (workout_id, user_id) values ($1, $2)
       on conflict (workout_id, user_id) do nothing`,
      [workoutId, request.user.id]
    );
    return { ok: true, ...(await getWorkoutLikeState(workoutId, request.user.id)) };
  });

  app.delete("/api/trainer/workouts/:id/like", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["trainer"]);
    const workoutId = Number((request.params as { id: string }).id);
    if (!(await trainerOwnsWorkout(request.user.id, workoutId))) {
      return reply.code(404).send({ message: "Тренировка не найдена" });
    }
    await pool.query(
      `delete from workout_likes where workout_id = $1 and user_id = $2`,
      [workoutId, request.user.id]
    );
    return { ok: true, ...(await getWorkoutLikeState(workoutId, request.user.id)) };
  });

  app.get("/api/trainer/workouts/:id/likes", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["trainer"]);
    const workoutId = Number((request.params as { id: string }).id);
    if (!(await trainerOwnsWorkout(request.user.id, workoutId))) {
      return reply.code(404).send({ message: "Тренировка не найдена" });
    }
    return { likers: await getWorkoutLikers(workoutId) };
  });

  app.get("/api/trainer/workouts/:id/comments", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["trainer"]);
    const workoutId = Number((request.params as { id: string }).id);
    const { channel } = commentChannelQuery.parse(request.query);
    if (!(await trainerOwnsWorkout(request.user.id, workoutId))) {
      return reply.code(404).send({ message: "Тренировка не найдена" });
    }
    return { comments: await listWorkoutComments(workoutId, request.user.id, true, channel) };
  });

  app.post("/api/trainer/workouts/:id/comments", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["trainer"]);
    const workoutId = Number((request.params as { id: string }).id);
    const body = workoutCommentSchema.parse(request.body);
    if (!(await trainerOwnsWorkout(request.user.id, workoutId))) {
      return reply.code(404).send({ message: "Тренировка не найдена" });
    }
    await addWorkoutComment(workoutId, request.user.id, body.body, body.channel);
    return { ok: true, comments: await listWorkoutComments(workoutId, request.user.id, true, body.channel) };
  });

  // Тренер модерирует: удаляет любой комментарий на тренировках своих атлетов
  app.delete("/api/trainer/comments/:id", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["trainer"]);
    const commentId = Number((request.params as { id: string }).id);
    const { rowCount } = await pool.query(
      `
        delete from workout_comments c
        using workouts w, users u
        where c.id = $1
          and w.id = c.workout_id
          and u.id = w.user_id
          and (u.coach_id = $2 or c.author_id = $2)
      `,
      [commentId, request.user.id]
    );
    if (rowCount === 0) {
      return reply.code(404).send({ message: "Комментарий не найден" });
    }
    return { ok: true };
  });
}
