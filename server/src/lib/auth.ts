import bcrypt from "bcryptjs";
import { FastifyReply, FastifyRequest } from "fastify";

import { AuthUser, AppRole } from "../types.js";
import { config } from "../config.js";

const AUTH_COOKIE = "runrehab_token";
const AUTH_COOKIE_TTL_SECONDS = 14 * 24 * 60 * 60;

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
  const token = await reply.jwtSign(user, { expiresIn: "14d" });
  reply.setCookie(AUTH_COOKIE, token, authCookieOptions);
}

export function clearAuthCookie(reply: FastifyReply) {
  reply.clearCookie(AUTH_COOKIE, authCookieOptions);
  reply.clearCookie(AUTH_COOKIE, insecureAuthCookieOptions);
}

export async function requireAuth(request: FastifyRequest) {
  await request.jwtVerify();
}

export function requireRole(request: FastifyRequest, roles: AppRole[]) {
  if (!roles.includes(request.user.role)) {
    throw new Error("FORBIDDEN");
  }
}
