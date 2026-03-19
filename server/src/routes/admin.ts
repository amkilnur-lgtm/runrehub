import { FastifyInstance } from "fastify";
import { z } from "zod";

import { config } from "../config.js";
import { hashPassword, requireAuth, requireRole } from "../lib/auth.js";
import { pool } from "../lib/db.js";
import { syncLatestActivities } from "../lib/strava.js";

const createUserSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(6),
  fullName: z.string().min(2),
  role: z.enum(["trainer", "athlete"]),
  coachId: z.number().nullable().optional()
});

const webhookTestSchema = z.object({
  ownerId: z.number().int().positive()
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

  app.post("/api/admin/strava/webhook-test", { preHandler: requireAuth }, async (request) => {
    requireRole(request, ["admin"]);
    const body = webhookTestSchema.parse(request.body);
    const log: string[] = [`Webhook test started for owner_id=${body.ownerId}`];

    const athleteResult = await pool.query(
      `
        select sc.user_id, u.full_name
        from strava_connections sc
        join users u on u.id = sc.user_id
        where sc.strava_athlete_id = $1
      `,
      [body.ownerId]
    );

    const athlete = athleteResult.rows[0] as { user_id: number; full_name: string } | undefined;
    if (!athlete) {
      log.push("No connected athlete found for this owner_id.");
      return { ok: false, log };
    }

    log.push(`Matched athlete: ${athlete.full_name} (user_id=${athlete.user_id})`);
    try {
      const result = await syncLatestActivities(athlete.user_id);
      log.push(`Sync result: ${JSON.stringify(result)}`);
      return { ok: true, log };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      log.push(`Sync failed: ${message}`);
      return { ok: false, log };
    }
  });

  app.post("/api/admin/strava/cron-run", { preHandler: requireAuth }, async (request) => {
    requireRole(request, ["admin"]);
    const intervalMinutes = config.STRAVA_SYNC_INTERVAL_MINUTES;
    const log: string[] = [`Cron run started with interval=${intervalMinutes}m`];

    const dueResult = await pool.query(
      `
        select sc.user_id, u.full_name
        from strava_connections sc
        join users u on u.id = sc.user_id
        where sc.last_synced_at is null
           or sc.last_synced_at < now() - make_interval(mins => $1::int)
        order by coalesce(sc.last_synced_at, to_timestamp(0)) asc
      `,
      [intervalMinutes]
    );

    if (dueResult.rows.length === 0) {
      log.push("No due athletes found.");
      return { ok: true, log };
    }

    for (const row of dueResult.rows as Array<{ user_id: number; full_name: string }>) {
      try {
        log.push(`Syncing ${row.full_name} (user_id=${row.user_id})`);
        const result = await syncLatestActivities(row.user_id);
        log.push(`Result: ${JSON.stringify(result)}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        log.push(`Failed for user_id=${row.user_id}: ${message}`);
      }
    }

    return { ok: true, log };
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
}
