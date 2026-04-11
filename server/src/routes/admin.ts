import { FastifyInstance } from "fastify";
import { z } from "zod";

import { hashPassword, requireAuth, requireRole } from "../lib/auth.js";
import { pool } from "../lib/db.js";
import { getStravaEvents } from "../lib/strava-events.js";
import { isTelegramConfigured } from "../lib/telegram.js";
import {
  getWeeklyReportWeekStartForDate,
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

const updateTrainerTelegramSchema = z.object({
  chatId: z.string().trim().max(128).nullable(),
  notificationsEnabled: z.boolean()
});

const weeklyTelegramTestSchema = z.object({
  weekDate: z.string().trim().min(10).max(32)
});

export async function adminRoutes(app: FastifyInstance) {
  app.get("/api/admin/users", { preHandler: requireAuth }, async (request) => {
    requireRole(request, ["admin"]);
    const { rows } = await pool.query(
      `
        select u.id, u.username, u.full_name, u.role, u.coach_id, coach.full_name as coach_name
        from users u
        left join users coach on coach.id = u.coach_id
        order by u.created_at desc
      `
    );
    return { users: rows };
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

  app.get("/api/admin/strava/events", { preHandler: requireAuth }, async (request) => {
    requireRole(request, ["admin"]);
    const query = stravaEventsQuerySchema.parse(request.query);
    return { events: getStravaEvents(query.limit) };
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
}
