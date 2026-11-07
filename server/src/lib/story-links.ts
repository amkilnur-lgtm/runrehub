import { FastifyInstance, FastifyReply } from "fastify";

import { config } from "../config.js";
import { pool } from "./db.js";
import { buildStoryCardPng } from "./telegram-notifications.js";

const STORY_LINK_TTL = "15m";

type StoryToken = { kind: "story"; workoutId: number };

// Подписываем тем же секретом, что и сессии, но с отдельным kind: сессионный
// токен сюда не подойдёт, а ссылка на картинку не даёт входа на сайт
export async function signStoryLink(reply: FastifyReply, workoutId: number) {
  const payload: StoryToken = { kind: "story", workoutId };
  const token = await reply.jwtSign(payload as never, { expiresIn: STORY_LINK_TTL });
  // токен в query: параметр пути в Fastify ограничен 100 символами, JWT длиннее
  return `${config.APP_URL.replace(/\/$/, "")}/api/story.png?t=${encodeURIComponent(token)}`;
}

export async function storyLinkRoutes(app: FastifyInstance) {
  app.get(
    "/api/story.png",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const token = String((request.query as { t?: unknown }).t ?? "");
      let payload: StoryToken;
      try {
        payload = app.jwt.verify<StoryToken>(token);
      } catch {
        return reply.code(404).send({ message: "Ссылка устарела" });
      }
      if (payload.kind !== "story" || !Number.isSafeInteger(payload.workoutId)) {
        return reply.code(404).send({ message: "Ссылка устарела" });
      }
      const { rows } = await pool.query(
        `select u.full_name from workouts w join users u on u.id = w.user_id where w.id = $1`,
        [payload.workoutId]
      );
      if (!rows[0]) {
        return reply.code(404).send({ message: "Тренировка не найдена" });
      }
      const png = await buildStoryCardPng(payload.workoutId, rows[0].full_name as string);
      return reply.header("Content-Type", "image/png").header("Cache-Control", "public, max-age=900").send(png);
    }
  );
}
