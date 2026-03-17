import { FastifyInstance } from "fastify";

import { requireAuth, requireRole } from "../lib/auth.js";
import { config } from "../config.js";
import { exchangeCodeForToken, syncLatestActivities } from "../lib/strava.js";

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
      return { "hub.challenge": query["hub.challenge"] };
    }

    return reply.code(403).send({ message: "forbidden" });
  });

  app.post("/api/strava/webhook", async (request) => {
    const body = request.body as { owner_id?: number };
    if (typeof body.owner_id === "number") {
      const athleteResult = await app.pg.query(
        `select user_id from strava_connections where strava_athlete_id = $1`,
        [body.owner_id]
      );
      const userId = athleteResult.rows[0]?.user_id as number | undefined;
      if (userId) {
        await syncLatestActivities(userId);
      }
    }
    return { ok: true };
  });
}
