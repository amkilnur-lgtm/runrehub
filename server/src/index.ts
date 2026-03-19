import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import fastifyStatic from "@fastify/static";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";

import { authRoutes } from "./routes/auth.js";
import { adminRoutes } from "./routes/admin.js";
import { athleteRoutes } from "./routes/athlete.js";
import { trainerRoutes } from "./routes/trainer.js";
import { stravaRoutes } from "./routes/strava.js";
import { config } from "./config.js";
import { ensureSchema, pool } from "./lib/db.js";
import { addStravaEvent } from "./lib/strava-events.js";
import { syncDueAthletes } from "./lib/strava.js";

declare module "fastify" {
  interface FastifyInstance {
    pg: typeof pool;
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = Fastify({ logger: true });
app.decorate("pg", pool);

// --- CORS: в production разрешаем только свои домены ---
await app.register(cors, {
  origin:
    config.NODE_ENV === "production"
      ? ["https://runrehab.ru", "https://www.runrehab.ru"]
      : true,
  credentials: true
});

await app.register(cookie);
await app.register(jwt, {
  secret: config.JWT_SECRET,
  cookie: {
    cookieName: "runrehab_token",
    signed: false
  }
});

// --- Rate limiting ---
await app.register(rateLimit, {
  max: 100, 
  timeWindow: "1 minute"
});

// --- Глобальный error handler ---
app.setErrorHandler((error: any, request, reply) => {
  // Ошибки Zod-валидации
  if (error.validation) {
    return reply.code(400).send({ message: "Ошибка валидации", details: error.validation });
  }
  // JWT-ошибки (неверный / истёкший токен)
  const jwtErrorCodes = new Set([
    "FST_JWT_NO_AUTHORIZATION_IN_COOKIE",
    "FST_JWT_AUTHORIZATION_TOKEN_EXPIRED",
    "FST_JWT_AUTHORIZATION_TOKEN_INVALID"
  ]);
  if (jwtErrorCodes.has(error.code)) {
    return reply.code(401).send({ message: "Не авторизован" });
  }
  // Ошибки доступа (requireRole)
  if (error.message === "FORBIDDEN") {
    return reply.code(403).send({ message: "Нет доступа" });
  }
  // Всё остальное
  request.log.error({ err: error, url: request.url }, "unhandled error");
  return reply.code(500).send({ message: "Внутренняя ошибка сервера" });
});

await ensureSchema();

await app.register(authRoutes);
await app.register(adminRoutes);
await app.register(athleteRoutes);
await app.register(trainerRoutes);
await app.register(stravaRoutes);

const publicDir = path.join(__dirname, "public");

// --- Кэш index.html: читаем один раз при старте, а не на каждый запрос ---
const indexHtml = fs.existsSync(publicDir)
  ? fs.readFileSync(path.join(publicDir, "index.html"), "utf8")
  : null;

if (indexHtml) {
  await app.register(fastifyStatic, {
    root: publicDir,
    prefix: "/"
  });
}

// --- Healthcheck с проверкой БД ---
app.get("/api/health", async (_request, reply) => {
  try {
    await pool.query("SELECT 1");
    return { ok: true };
  } catch {
    return reply.code(503).send({ ok: false, message: "Database unavailable" });
  }
});

if (indexHtml) {
  app.setNotFoundHandler(async (request, reply) => {
    if (request.raw.url?.startsWith("/api/")) {
      return reply.code(404).send({ message: "Not found" });
    }
    return reply.type("text/html").send(indexHtml);
  });
}

await app.listen({
  port: config.PORT,
  host: "0.0.0.0"
});

// --- Graceful shutdown ---
const shutdown = async () => {
  app.log.info("Shutting down...");
  try {
    await app.close();
    await pool.end();
  } finally {
    process.exit(0);
  }
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// --- Фоновая синхронизация Strava ---
const syncIntervalMs = config.STRAVA_SYNC_INTERVAL_MINUTES * 60 * 1000;
app.log.info(
  { intervalMinutes: config.STRAVA_SYNC_INTERVAL_MINUTES },
  "strava cron scheduler started"
);
addStravaEvent({
  source: "system",
  level: "info",
  message: "strava cron scheduler started",
  details: { intervalMinutes: config.STRAVA_SYNC_INTERVAL_MINUTES }
});
setInterval(() => {
  void syncDueAthletes(app.log);
}, syncIntervalMs);
