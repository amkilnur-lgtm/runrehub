import { FastifyInstance } from "fastify";
import { z } from "zod";

import { hashPassword, requireAuth, requireRole } from "../lib/auth.js";
import { pool } from "../lib/db.js";

const createUserSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(6),
  fullName: z.string().min(2),
  role: z.enum(["trainer", "athlete"]),
  coachId: z.number().nullable().optional()
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
