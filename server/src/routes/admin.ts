import { FastifyInstance } from "fastify";
import { z } from "zod";

import { hashPassword, requireAuth, requireRole } from "../lib/auth.js";
import { getForceIntervalMinutes, setForceIntervalMinutes } from "../lib/app-settings.js";
import { pool } from "../lib/db.js";
import { getStravaEvents } from "../lib/strava-events.js";
import {
  connectIntervalsAccount,
  disconnectIntervalsAccount,
  forceIntervalsAccountRefresh,
  normalizeIcuAthleteId,
  setIntervalsAccountCredentials,
  syncIntervalsLatestActivities,
  verifyIntervalsCredentials
} from "../lib/intervals.js";
import { isTelegramConfigured } from "../lib/telegram.js";
import {
  getMonthlyTelegramPreview,
  getMonthlyReportMonthStartForDate,
  getWeeklyTelegramPreview,
  getWeeklyReportWeekStartForDate,
  sendAthleteMonthlyTelegramReport,
  sendAthleteWeeklyTelegramReport,
  sendMonthlyTelegramTestMessages,
  sendTelegramTestMessage,
  sendWeeklyTelegramTestMessages
} from "../lib/telegram-notifications.js";

const createUserSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(6),
  fullName: z.string().min(2),
  role: z.enum(["trainer", "athlete"]),
  coachId: z.number().nullable().optional()
});

const stravaEventsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(100)
});

const connectIntervalsSchema = z.object({
  icuAthleteId: z.string().min(1).max(40),
  apiKey: z.string().min(8).max(200)
});

const intervalsCredentialsSchema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(1).max(200)
});

const updateTrainerTelegramSchema = z.object({
  chatId: z.string().trim().max(128).nullable(),
  notificationsEnabled: z.boolean()
});

const weeklyTelegramTestSchema = z.object({
  weekDate: z.string().trim().min(10).max(32)
});

const monthlyTelegramTestSchema = z.object({
  monthDate: z.string().trim().min(7).max(32)
});

const athleteWeeklyReportSchema = z.object({
  period: z.enum(["current", "previous"])
});

const fitnessSummaryQuerySchema = z.object({
  weeks: z.coerce.number().int().positive().max(12).default(8)
});

export async function adminRoutes(app: FastifyInstance) {
  app.get("/api/admin/users", { preHandler: requireAuth }, async (request) => {
    requireRole(request, ["admin"]);
    const { rows } = await pool.query(
      `
        select
          u.id, u.username, u.full_name, u.role, u.coach_id, coach.full_name as coach_name,
          ic.icu_athlete_id,
          ic.last_synced_at as intervals_last_synced_at,
          ic.last_sync_error as intervals_last_sync_error,
          (ic.icu_email is not null and ic.icu_password is not null) as intervals_has_account
        from users u
        left join users coach on coach.id = u.coach_id
        left join intervals_connections ic on ic.user_id = u.id
        order by u.created_at desc
      `
    );
    return { users: rows };
  });

  app.put("/api/admin/athletes/:id/intervals", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["admin"]);
    const params = request.params as { id: string };
    const athleteUserId = parseInt(params.id, 10);
    const body = connectIntervalsSchema.parse(request.body);

    const { rows } = await pool.query(`select id from users where id = $1 and role = 'athlete'`, [
      athleteUserId
    ]);
    if (!rows[0]) {
      return reply.code(404).send({ message: "Спортсмен не найден" });
    }

    const icuAthleteId = normalizeIcuAthleteId(body.icuAthleteId);
    const verification = await verifyIntervalsCredentials(icuAthleteId, body.apiKey);
    if (!verification.ok) {
      return reply.code(400).send({
        message:
          verification.status === 401 || verification.status === 403
            ? "intervals.icu не принял ключ: проверьте Athlete ID и API key"
            : `intervals.icu недоступен (${verification.status})`
      });
    }

    await connectIntervalsAccount(athleteUserId, icuAthleteId, body.apiKey);
    return { ok: true, icuAthleteId, athleteName: verification.athleteName };
  });

  app.delete("/api/admin/athletes/:id/intervals", { preHandler: requireAuth }, async (request) => {
    requireRole(request, ["admin"]);
    const params = request.params as { id: string };
    await disconnectIntervalsAccount(parseInt(params.id, 10));
    return { ok: true };
  });

  app.post("/api/admin/athletes/:id/intervals/sync", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["admin"]);
    const params = request.params as { id: string };
    try {
      const result = await syncIntervalsLatestActivities(parseInt(params.id, 10), { forceDeep: true });
      return result;
    } catch (error) {
      return reply.code(502).send({
        message: error instanceof Error ? error.message.slice(0, 300) : "Ошибка синхронизации"
      });
    }
  });

  app.get("/api/admin/settings", { preHandler: requireAuth }, async (request) => {
    requireRole(request, ["admin"]);
    return { forceIntervalMinutes: await getForceIntervalMinutes() };
  });

  app.put("/api/admin/settings", { preHandler: requireAuth }, async (request) => {
    requireRole(request, ["admin"]);
    const body = z.object({ forceIntervalMinutes: z.coerce.number().int().min(5).max(1440) }).parse(request.body);
    const saved = await setForceIntervalMinutes(body.forceIntervalMinutes);
    return { ok: true, forceIntervalMinutes: saved };
  });

  // Сохранить логин-пароль от аккаунта intervals.icu (для форс-синка)
  app.put("/api/admin/athletes/:id/intervals/account", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["admin"]);
    const athleteUserId = parseInt((request.params as { id: string }).id, 10);
    const body = intervalsCredentialsSchema.parse(request.body);
    const { rows } = await pool.query(
      `select 1 from intervals_connections where user_id = $1`,
      [athleteUserId]
    );
    if (!rows[0]) {
      return reply.code(400).send({ message: "Сначала подключите intervals.icu (Athlete ID + API key)" });
    }
    await setIntervalsAccountCredentials(athleteUserId, body.email, body.password);
    return { ok: true };
  });

  // Форс-синк: логин на intervals.icu + activities-sync (подтолкнуть COROS),
  // подождать, пока intervals.icu заберёт из COROS, затем глубокий проход к нам.
  app.post("/api/admin/athletes/:id/intervals/force-sync", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["admin"]);
    const athleteUserId = parseInt((request.params as { id: string }).id, 10);
    try {
      const forced = await forceIntervalsAccountRefresh(athleteUserId);
      if (!forced.forced) {
        if (forced.reason === "no_credentials") {
          return reply.code(400).send({ message: "Не сохранён логин-пароль от intervals.icu" });
        }
        return reply.code(502).send({
          message: `Не удалось форсировать intervals.icu (${forced.reason}${forced.detail ? `: ${forced.detail}` : ""})`
        });
      }
      // даём intervals.icu время подтянуть из COROS
      await new Promise((resolve) => setTimeout(resolve, 9000));
      const result = await syncIntervalsLatestActivities(athleteUserId, { forceDeep: true });
      return { ...result, forced: true };
    } catch (error) {
      return reply.code(502).send({
        message: error instanceof Error ? error.message.slice(0, 300) : "Ошибка форс-синка"
      });
    }
  });

  app.get("/api/admin/trainers", { preHandler: requireAuth }, async (request) => {
    requireRole(request, ["admin"]);
    const { rows } = await pool.query(
      `select id, full_name from users where role = 'trainer' order by full_name asc`
    );
    return { trainers: rows };
  });

  app.get("/api/admin/trainers/telegram", { preHandler: requireAuth }, async (request) => {
    requireRole(request, ["admin"]);
    const { rows } = await pool.query(
      `
        select
          trainer.id,
          trainer.full_name,
          trainer.telegram_chat_id,
          trainer.telegram_notifications_enabled,
          coalesce(count(job.id) filter (where job.status in ('pending', 'processing')), 0)::int as pending_jobs,
          coalesce(count(job.id) filter (where job.status = 'sent'), 0)::int as sent_jobs
        from users trainer
        left join telegram_notification_jobs job on job.coach_user_id = trainer.id
        where trainer.role = 'trainer'
        group by trainer.id
        order by trainer.full_name asc
      `
    );

    return {
      configured: isTelegramConfigured(),
      trainers: rows
    };
  });

  app.get("/api/admin/events", { preHandler: requireAuth }, async (request) => {
    requireRole(request, ["admin"]);
    const query = stravaEventsQuerySchema.parse(request.query);
    return { events: getStravaEvents(query.limit) };
  });

  app.get("/api/admin/fitness/summary", { preHandler: requireAuth }, async (request) => {
    requireRole(request, ["admin"]);
    const query = fitnessSummaryQuerySchema.parse(request.query);

    const { rows } = await pool.query(
      `
        with week_bounds as (
          select (date_trunc('week', now())::date - (($1::int - 1) * 7))::date as first_week,
                 date_trunc('week', now())::date as current_week
        ),
        athletes as (
          select id, full_name
          from users
          where role = 'athlete'
          order by full_name asc
        ),
        weeks as (
          select
            athlete.id as athlete_id,
            athlete.full_name as athlete_name,
            (bounds.first_week + (series.value * 7))::date as week_start
          from athletes athlete
          cross join week_bounds bounds
          cross join generate_series(0, $1::int - 1) as series(value)
        ),
        base_runs as (
          select
            w.user_id,
            w.id,
            (w.start_date::date - (extract(isodow from w.start_date)::int - 1))::date as week_start
          from workouts w
          join week_bounds bounds on w.start_date::date >= bounds.first_week
          where w.sport_type = 'Run'
        ),
        reliable_scores as (
          select
            w.user_id,
            w.id,
            w.start_date::date as run_date,
            (w.start_date::date - (extract(isodow from w.start_date)::int - 1))::date as week_start,
            wa.fitness_score,
            wa.aerobic_score,
            wa.estimated_hrmax
          from workouts w
          join workout_analysis wa on wa.workout_id = w.id
          join week_bounds bounds on w.start_date::date >= bounds.first_week - 49
          where wa.gps_quality_status = 'reliable'
            and wa.fitness_score is not null
        ),
        weekly as (
          select
            weeks.athlete_id,
            weeks.athlete_name,
            weeks.week_start,
            count(distinct base_runs.id)::int as runs,
            count(distinct reliable_scores.id) filter (where reliable_scores.week_start = weeks.week_start)::int as score_runs,
            round(max(reliable_scores.estimated_hrmax)::numeric, 0)::float8 as estimated_hrmax,
            round(max(reliable_scores.fitness_score) filter (where reliable_scores.week_start = weeks.week_start)::numeric, 2)::float8 as week_best_score,
            round(avg(reliable_scores.aerobic_score) filter (
              where reliable_scores.week_start = weeks.week_start
                and reliable_scores.aerobic_score is not null
            )::numeric, 2)::float8 as aerobic_avg_score,
            round(max(
              reliable_scores.fitness_score *
              case
                when (weeks.week_start - reliable_scores.run_date) <= 7 then 1.00
                when (weeks.week_start - reliable_scores.run_date) <= 14 then 0.97
                when (weeks.week_start - reliable_scores.run_date) <= 28 then 0.92
                when (weeks.week_start - reliable_scores.run_date) <= 42 then 0.85
                else 0.75
              end
            ) filter (
              where reliable_scores.run_date <= weeks.week_start + 6
                and reliable_scores.run_date >= weeks.week_start - 49
            )::numeric, 2)::float8 as fitness_index
          from weeks
          left join base_runs on base_runs.user_id = weeks.athlete_id
            and base_runs.week_start = weeks.week_start
          left join reliable_scores on reliable_scores.user_id = weeks.athlete_id
          group by weeks.athlete_id, weeks.athlete_name, weeks.week_start
        )
        select *
        from weekly
        order by athlete_name asc, week_start desc
      `,
      [query.weeks]
    );

    return { weeks: query.weeks, rows };
  });

  app.post("/api/admin/users", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["admin"]);
    const body = createUserSchema.parse(request.body);
    const passwordHash = await hashPassword(body.password);
    const coachId = body.role === "athlete" ? body.coachId ?? null : null;

    try {
      const { rows } = await pool.query(
        `
          insert into users (username, password_hash, full_name, role, coach_id)
          values ($1, $2, $3, $4, $5)
          returning id, username, full_name, role, coach_id
        `,
        [body.username, passwordHash, body.fullName, body.role, coachId]
      );
      return { user: rows[0] };
    } catch {
      return reply.code(400).send({ message: "Не удалось создать пользователя" });
    }
  });

  app.delete("/api/admin/users/:id", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["admin"]);
    const params = request.params as { id: string };
    const targetUserId = parseInt(params.id, 10);

    if (targetUserId === request.user.id) {
      return reply.code(400).send({ message: "Нельзя удалить самого себя" });
    }

    const { rowCount } = await pool.query(
      `delete from users where id = $1 and role != 'admin'`,
      [targetUserId]
    );

    if (rowCount === 0) {
      return reply.code(404).send({ message: "Пользователь не найден или его нельзя удалить" });
    }

    return { ok: true };
  });

  app.put("/api/admin/trainers/:id/telegram", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["admin"]);
    const params = request.params as { id: string };
    const trainerId = parseInt(params.id, 10);
    const body = updateTrainerTelegramSchema.parse(request.body);
    const chatId = body.chatId?.trim() ? body.chatId.trim() : null;

    const { rows } = await pool.query(
      `
        update users
        set telegram_chat_id = $2,
            telegram_notifications_enabled = $3
        where id = $1
          and role = 'trainer'
        returning id, full_name, telegram_chat_id, telegram_notifications_enabled
      `,
      [trainerId, chatId, body.notificationsEnabled]
    );

    if (!rows[0]) {
      return reply.code(404).send({ message: "Trainer not found" });
    }

    return { trainer: rows[0] };
  });

  app.post("/api/admin/trainers/:id/telegram/test", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["admin"]);

    if (!isTelegramConfigured()) {
      return reply.code(400).send({ message: "Telegram bot is not configured" });
    }

    const params = request.params as { id: string };
    const trainerId = parseInt(params.id, 10);
    const { rows } = await pool.query(
      `
        select id, full_name, telegram_chat_id
        from users
        where id = $1
          and role = 'trainer'
      `,
      [trainerId]
    );

    const trainer = rows[0] as
      | { id: number; full_name: string; telegram_chat_id: string | null }
      | undefined;

    if (!trainer) {
      return reply.code(404).send({ message: "Trainer not found" });
    }

    if (!trainer.telegram_chat_id?.trim()) {
      return reply.code(400).send({ message: "Telegram chat id is empty" });
    }

    await sendTelegramTestMessage(trainer.telegram_chat_id, trainer.full_name);
    return { ok: true };
  });

  app.post(
    "/api/admin/athletes/:id/telegram/weekly-send",
    { preHandler: requireAuth },
    async (request, reply) => {
      requireRole(request, ["admin"]);

      if (!isTelegramConfigured()) {
        return reply.code(400).send({ message: "Telegram bot is not configured" });
      }

      const params = request.params as { id: string };
      const athleteId = parseInt(params.id, 10);
      const body = athleteWeeklyReportSchema.parse(request.body);

      try {
        const result = await sendAthleteWeeklyTelegramReport(athleteId, body.period);
        return {
          ok: true,
          athleteName: result.athleteName,
          coachName: result.coachName,
          weekStart: result.weekStart
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";

        if (message === "ATHLETE_NOT_FOUND") {
          return reply.code(404).send({ message: "Athlete not found" });
        }

        if (message === "ATHLETE_COACH_NOT_FOUND") {
          return reply.code(400).send({ message: "Athlete has no coach" });
        }

        if (message === "TELEGRAM_CHAT_ID_EMPTY") {
          return reply.code(400).send({ message: "Coach Telegram chat id is empty" });
        }

        if (message === "WEEKLY_REPORT_NOT_FOUND") {
          return reply.code(400).send({ message: "No workouts for the selected week" });
        }

        throw error;
      }
    }
  );

  app.post(
    "/api/admin/athletes/:id/telegram/monthly-send",
    { preHandler: requireAuth },
    async (request, reply) => {
      requireRole(request, ["admin"]);

      if (!isTelegramConfigured()) {
        return reply.code(400).send({ message: "Telegram bot is not configured" });
      }

      const params = request.params as { id: string };
      const athleteId = parseInt(params.id, 10);
      const body = athleteWeeklyReportSchema.parse(request.body);

      try {
        const result = await sendAthleteMonthlyTelegramReport(athleteId, body.period);
        return {
          ok: true,
          athleteName: result.athleteName,
          coachName: result.coachName,
          monthStart: result.monthStart
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";

        if (message === "ATHLETE_NOT_FOUND") {
          return reply.code(404).send({ message: "Athlete not found" });
        }

        if (message === "ATHLETE_COACH_NOT_FOUND") {
          return reply.code(400).send({ message: "Athlete has no coach" });
        }

        if (message === "TELEGRAM_CHAT_ID_EMPTY") {
          return reply.code(400).send({ message: "Coach Telegram chat id is empty" });
        }

        if (message === "MONTHLY_REPORT_NOT_FOUND") {
          return reply.code(400).send({ message: "No workouts for the selected month" });
        }

        throw error;
      }
    }
  );

  app.post(
    "/api/admin/trainers/:id/telegram/weekly-preview",
    { preHandler: requireAuth },
    async (request, reply) => {
      requireRole(request, ["admin"]);

      const params = request.params as { id: string };
      const trainerId = parseInt(params.id, 10);
      const body = weeklyTelegramTestSchema.parse(request.body);

      try {
        const result = await getWeeklyTelegramPreview(trainerId, body.weekDate);
        return {
          ok: true,
          weekStart: result.reportWeekStart,
          skipped: result.skipped,
          trainerHasChatId: result.trainerHasChatId,
          reports: result.reports.map((report) => ({
            athleteUserId: report.athleteUserId,
            athleteName: report.athleteName,
            workoutCount: report.workoutCount,
            totalDistanceMeters: report.totalDistanceMeters,
            totalMovingTimeSeconds: report.totalMovingTimeSeconds,
            totalElevationGain: report.totalElevationGain,
            averageSpeed: report.averageSpeed,
            averageHeartrate: report.averageHeartrate,
            zonePercentages: report.zonePercentages
          }))
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";

        if (message === "TRAINER_NOT_FOUND") {
          return reply.code(404).send({ message: "Trainer not found" });
        }

        if (message === "INVALID_REPORT_WEEK_START") {
          return reply.code(400).send({
            message: `Invalid week date. Resolved week start: ${getWeeklyReportWeekStartForDate(new Date())}`
          });
        }

        throw error;
      }
    }
  );

  app.post(
    "/api/admin/trainers/:id/telegram/weekly-test",
    { preHandler: requireAuth },
    async (request, reply) => {
      requireRole(request, ["admin"]);

      if (!isTelegramConfigured()) {
        return reply.code(400).send({ message: "Telegram bot is not configured" });
      }

      const params = request.params as { id: string };
      const trainerId = parseInt(params.id, 10);
      const body = weeklyTelegramTestSchema.parse(request.body);

      try {
        const result = await sendWeeklyTelegramTestMessages(trainerId, body.weekDate);
        return {
          ok: true,
          weekStart: result.reportWeekStart,
          sent: result.sent,
          skipped: result.skipped
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";

        if (message === "TRAINER_NOT_FOUND") {
          return reply.code(404).send({ message: "Trainer not found" });
        }

        if (message === "TELEGRAM_CHAT_ID_EMPTY") {
          return reply.code(400).send({ message: "Telegram chat id is empty" });
        }

        if (message === "INVALID_REPORT_WEEK_START") {
          return reply.code(400).send({
            message: `Invalid week date. Resolved week start: ${getWeeklyReportWeekStartForDate(new Date())}`
          });
        }

        throw error;
      }
    }
  );

  app.post(
    "/api/admin/trainers/:id/telegram/monthly-preview",
    { preHandler: requireAuth },
    async (request, reply) => {
      requireRole(request, ["admin"]);

      const params = request.params as { id: string };
      const trainerId = parseInt(params.id, 10);
      const body = monthlyTelegramTestSchema.parse(request.body);

      try {
        const result = await getMonthlyTelegramPreview(trainerId, body.monthDate);
        return {
          ok: true,
          monthStart: result.reportMonthStart,
          skipped: result.skipped,
          trainerHasChatId: result.trainerHasChatId,
          reports: result.reports.map((report) => ({
            athleteUserId: report.athleteUserId,
            athleteName: report.athleteName,
            workoutCount: report.workoutCount,
            totalDistanceMeters: report.totalDistanceMeters,
            totalMovingTimeSeconds: report.totalMovingTimeSeconds,
            totalElevationGain: report.totalElevationGain,
            averageSpeed: report.averageSpeed,
            averageHeartrate: report.averageHeartrate,
            zonePercentages: report.zonePercentages
          }))
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";

        if (message === "TRAINER_NOT_FOUND") {
          return reply.code(404).send({ message: "Trainer not found" });
        }

        if (message === "INVALID_REPORT_WEEK_START" || message === "INVALID_REPORT_MONTH_START") {
          return reply.code(400).send({
            message: `Invalid month date. Resolved month start: ${getMonthlyReportMonthStartForDate(new Date())}`
          });
        }

        throw error;
      }
    }
  );

  app.post(
    "/api/admin/trainers/:id/telegram/monthly-test",
    { preHandler: requireAuth },
    async (request, reply) => {
      requireRole(request, ["admin"]);

      if (!isTelegramConfigured()) {
        return reply.code(400).send({ message: "Telegram bot is not configured" });
      }

      const params = request.params as { id: string };
      const trainerId = parseInt(params.id, 10);
      const body = monthlyTelegramTestSchema.parse(request.body);

      try {
        const result = await sendMonthlyTelegramTestMessages(trainerId, body.monthDate);
        return {
          ok: true,
          monthStart: result.reportMonthStart,
          sent: result.sent,
          skipped: result.skipped
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";

        if (message === "TRAINER_NOT_FOUND") {
          return reply.code(404).send({ message: "Trainer not found" });
        }

        if (message === "TELEGRAM_CHAT_ID_EMPTY") {
          return reply.code(400).send({ message: "Telegram chat id is empty" });
        }

        if (message === "INVALID_REPORT_WEEK_START" || message === "INVALID_REPORT_MONTH_START") {
          return reply.code(400).send({
            message: `Invalid month date. Resolved month start: ${getMonthlyReportMonthStartForDate(new Date())}`
          });
        }

        throw error;
      }
    }
  );
}
