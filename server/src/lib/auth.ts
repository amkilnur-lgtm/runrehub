import bcrypt from "bcryptjs";
import { FastifyReply, FastifyRequest } from "fastify";

import { AuthUser, AppRole } from "../types.js";

const AUTH_COOKIE = "runrehab_token";

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
  const token = await reply.jwtSign(user, { expiresIn: "14d" });
  reply.setCookie(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/"
  });
}

export function clearAuthCookie(reply: FastifyReply) {
  reply.clearCookie(AUTH_COOKIE, { path: "/" });
}

export async function requireAuth(request: FastifyRequest) {
  await request.jwtVerify();
}

export function requireRole(request: FastifyRequest, roles: AppRole[]) {
  if (!roles.includes(request.user.role)) {
    throw new Error("FORBIDDEN");
  }
}
