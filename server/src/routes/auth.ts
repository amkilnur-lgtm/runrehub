import { FastifyInstance } from "fastify";
import { z } from "zod";

import { pool } from "../lib/db.js";
import { clearAuthCookie, setAuthCookie, verifyPassword } from "../lib/auth.js";
import { AuthUser } from "../types.js";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

export async function authRoutes(app: FastifyInstance) {
  app.post(
    "/api/auth/login",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "1 minute"
        }
      }
    },
    async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const { rows } = await pool.query(
      `select id, username, full_name, role, coach_id, password_hash from users where username = $1`,
      [body.username]
    );
    const user = rows[0];

    if (!user) {
      return reply.code(401).send({ message: "Неверный логин или пароль" });
    }

    const isValid = await verifyPassword(body.password, user.password_hash);
    if (!isValid) {
      return reply.code(401).send({ message: "Неверный логин или пароль" });
    }

    const authUser: AuthUser = {
      id: user.id,
      username: user.username,
      fullName: user.full_name,
      role: user.role,
      coachId: user.coach_id
    };

    await setAuthCookie(reply, authUser);
    return { user: authUser };
  });

  app.post("/api/auth/logout", async (_request, reply) => {
    clearAuthCookie(reply);
    return { ok: true };
  });

  app.get("/api/auth/me", async (request, reply) => {
    try {
      await request.jwtVerify();
      return { user: request.user };
    } catch {
      return reply.code(401).send({ message: "Не авторизован" });
    }
  });
}
