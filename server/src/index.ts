import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";

import { authRoutes } from "./routes/auth.js";
import { adminRoutes } from "./routes/admin.js";
import { athleteRoutes } from "./routes/athlete.js";
import { trainerRoutes } from "./routes/trainer.js";
import { stravaRoutes } from "./routes/strava.js";
import { config } from "./config.js";
import { ensureSchema, pool } from "./lib/db.js";
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

await app.register(cors, {
  origin: true,
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

await ensureSchema();

await app.register(authRoutes);
await app.register(adminRoutes);
await app.register(athleteRoutes);
await app.register(trainerRoutes);
await app.register(stravaRoutes);

const publicDir = path.join(__dirname, "public");
if (fs.existsSync(publicDir)) {
  await app.register(fastifyStatic, {
    root: publicDir,
    prefix: "/"
  });
}

app.get("/api/health", async () => ({ ok: true }));

if (fs.existsSync(publicDir)) {
  app.setNotFoundHandler(async (request, reply) => {
    if (request.raw.url?.startsWith("/api/")) {
      return reply.code(404).send({ message: "Not found" });
    }

    return reply.type("text/html").send(fs.readFileSync(path.join(publicDir, "index.html"), "utf8"));
  });
}

await app.listen({
  port: config.PORT,
  host: "0.0.0.0"
});

const syncIntervalMs = config.STRAVA_SYNC_INTERVAL_MINUTES * 60 * 1000;
setInterval(() => {
  void syncDueAthletes(app.log);
}, syncIntervalMs);
