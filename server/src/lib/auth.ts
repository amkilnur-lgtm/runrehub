import bcrypt from "bcryptjs";
import { FastifyReply, FastifyRequest } from "fastify";

import { AuthUser, AppRole } from "../types.js";
import { config } from "../config.js";
import { pool } from "./db.js";

const AUTH_COOKIE = "runrehab_token";
const AUTH_COOKIE_TTL_SECONDS = 30 * 24 * 60 * 60;

const authCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: config.NODE_ENV === "production",
  maxAge: AUTH_COOKIE_TTL_SECONDS
};

const insecureAuthCookieOptions = {
  ...authCookieOptions,
  secure: false
};

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: AuthUser;
    user: AuthUser;
  }
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function setAuthCookie(reply: FastifyReply, user: AuthUser) {
  const token = await reply.jwtSign(user, { expiresIn: "30d" });
  reply.setCookie(AUTH_COOKIE, token, authCookieOptions);
}

export function clearAuthCookie(reply: FastifyReply) {
  reply.clearCookie(AUTH_COOKIE, authCookieOptions);
  reply.clearCookie(AUTH_COOKIE, insecureAuthCookieOptions);
}

// Токен живёт 30 дней, а роль, тренер и сам пользователь могут поменяться:
// подпись проверяем по JWT, но актуальные данные берём из базы
export async function loadCurrentUser(userId: number): Promise<AuthUser | null> {
  const { rows } = await pool.query(
    `select id, username, full_name, avatar_url, role, coach_id from users where id = $1`,
    [userId]
  );
  const user = rows[0];
  if (!user) {
    return null;
  }
  return {
    id: user.id,
    username: user.username,
    fullName: user.full_name,
    avatarUrl: user.avatar_url,
    role: user.role,
    coachId: user.coach_id
  };
}

export async function requireAuth(request: FastifyRequest) {
  await request.jwtVerify();
  const user = await loadCurrentUser(request.user.id);
  if (!user) {
    throw Object.assign(new Error("Не авторизован"), { statusCode: 401 });
  }
  request.user = user;
}

export function requireRole(request: FastifyRequest, roles: AppRole[]) {
  if (!roles.includes(request.user.role)) {
    throw new Error("FORBIDDEN");
  }
}
