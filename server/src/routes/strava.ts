import { FastifyInstance } from "fastify";

import { requireAuth, requireRole } from "../lib/auth.js";
import { pool } from "../lib/db.js";
import { addStravaEvent } from "../lib/strava-events.js";
import { config } from "../config.js";
import { exchangeCodeForToken, registerStravaWebhookEvent, syncLatestActivities } from "../lib/strava.js";

export async function stravaRoutes(app: FastifyInstance) {
  app.get("/api/strava/callback", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["athlete"]);
    const query = request.query as { code?: string };

    if (!query.code) {
      return reply.redirect("/athlete");
    }

    await exchangeCodeForToken(query.code, request.user.id);
    await syncLatestActivities(request.user.id);
    return reply.redirect("/athlete");
  });

  app.get("/api/strava/webhook", async (request, reply) => {
    const query = request.query as {
      "hub.mode"?: string;
      "hub.verify_token"?: string;
      "hub.challenge"?: string;
    };

    if (
      query["hub.mode"] === "subscribe" &&
      query["hub.verify_token"] === config.STRAVA_WEBHOOK_VERIFY_TOKEN
    ) {
      app.log.info({ mode: query["hub.mode"] }, "strava webhook verified");
      addStravaEvent({
        source: "webhook",
        level: "info",
        message: "strava webhook verified",
        details: { mode: query["hub.mode"] ?? null }
      });
      return { "hub.challenge": query["hub.challenge"] };
    }

    app.log.warn({ mode: query["hub.mode"] }, "strava webhook verification rejected");
    addStravaEvent({
      source: "webhook",
      level: "warn",
      message: "strava webhook verification rejected",
      details: { mode: query["hub.mode"] ?? null }
    });
    return reply.code(403).send({ message: "forbidden" });
  });

  // Webhook POST: отвечаем Strava немедленно, sync выполняется в фоне (fire-and-forget).
  // Это критично: Strava ждёт ответ не более 2 секунд, иначе отключает подписку.
  app.post("/api/strava/webhook", async (request) => {
    const body = request.body as {
      owner_id?: number;
      object_id?: number;
      aspect_type?: string;
      object_type?: string;
      event_time?: number;
      subscription_id?: number;
      updates?: Record<string, unknown>;
    };
    app.log.info({ owner_id: body.owner_id ?? null }, "strava webhook received");
    addStravaEvent({
      source: "webhook",
      level: "info",
      message: "strava webhook received",
      details: { ownerId: body.owner_id ?? null }
    });

    const webhookEvent = await registerStravaWebhookEvent(body);
    if (webhookEvent.isDuplicate) {
      app.log.info({ owner_id: body.owner_id ?? null }, "strava webhook duplicate skipped");
      addStravaEvent({
        source: "webhook",
        level: "info",
        message: "strava webhook duplicate skipped",
        details: { ownerId: body.owner_id ?? null }
      });
      return { ok: true, duplicate: true };
    }

    if (typeof body.owner_id === "number") {
      const ownerId = body.owner_id;
      // Не используем await — ответ возвращается до завершения sync
      void (async () => {
        try {
          const athleteResult = await pool.query(
            `select user_id from strava_connections where strava_athlete_id = $1`,
            [ownerId]
          );
          const userId = athleteResult.rows[0]?.user_id as number | undefined;
          if (!userId) {
            app.log.info({ owner_id: ownerId }, "strava webhook skipped: athlete not connected");
            addStravaEvent({
              source: "webhook",
              level: "info",
              message: "strava webhook skipped: athlete not connected",
              details: { ownerId }
            });
            return;
          }

          const result = await syncLatestActivities(userId);
          app.log.info({ owner_id: ownerId, userId, result }, "strava webhook sync completed");
          addStravaEvent({
            source: "webhook",
            level: "info",
            message: "strava webhook sync completed",
            details: { ownerId, userId, result }
          });
        } catch (err) {
          app.log.error({ err, owner_id: ownerId }, "webhook background sync failed");
          addStravaEvent({
            source: "webhook",
            level: "error",
            message: "webhook background sync failed",
            details: {
              ownerId,
              error: err instanceof Error ? err.message : "Unknown error"
            }
          });
        }
      })();
    }

    return { ok: true };
  });
}
