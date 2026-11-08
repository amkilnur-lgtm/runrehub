import { FastifyInstance, FastifyRequest } from "fastify";

import { requireAuth, requireRole } from "../lib/auth.js";
import { pool } from "../lib/db.js";
import {
  deleteRaceResult,
  getAthleteResults,
  getRaceResultOwner,
  insertRaceResult,
  raceResultSchema,
  standardDistanceFor,
  updateRaceResult,
  type RaceResultRow
} from "../lib/race-results.js";
import { isAthleteInGroup } from "../lib/social.js";
import { escapeTelegramHtml, isTelegramConfigured, sendTelegramMessage } from "../lib/telegram.js";

// Кто что может: смотреть — сам спортсмен, одногруппники и его тренер;
// менять — сам спортсмен и его тренер
async function canView(request: FastifyRequest, athleteId: number) {
  if (request.user.role === "athlete") {
    return isAthleteInGroup(request.user.id, athleteId);
  }
  if (request.user.role === "trainer") {
    return isCoachOf(request.user.id, athleteId);
  }
  return false;
}

async function isCoachOf(coachId: number, athleteId: number) {
  const { rows } = await pool.query(`select 1 from users where id = $1 and role = 'athlete' and coach_id = $2`, [
    athleteId,
    coachId
  ]);
  return rows.length > 0;
}

async function canEdit(request: FastifyRequest, athleteId: number) {
  if (request.user.role === "athlete") return request.user.id === athleteId;
  if (request.user.role === "trainer") return isCoachOf(request.user.id, athleteId);
  return false;
}

function parseId(value: unknown) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function formatRaceTime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

// Новый личный рекорд — короткое сообщение тренеру в Telegram (если чат подключён)
async function notifyCoachAboutRecord(result: RaceResultRow) {
  if (result.status !== "finished" || !result.official_time_seconds || !isTelegramConfigured()) return;
  const distance = standardDistanceFor(result.distance_meters);
  if (!distance) return;
  const { personalBests } = await getAthleteResults(result.user_id);
  const best = personalBests.find((item) => item.distanceMeters === distance.meters);
  if (!best || best.result?.id !== result.id) return;

  const { rows: people } = await pool.query(
    `
      select a.full_name, c.telegram_chat_id, c.telegram_notifications_enabled
      from users a join users c on c.id = a.coach_id
      where a.id = $1
    `,
    [result.user_id]
  );
  const person = people[0];
  if (!person?.telegram_chat_id || !person.telegram_notifications_enabled) return;
  const improvement = best.improvementSeconds ? ` (−${formatRaceTime(best.improvementSeconds)})` : "";
  const text =
    `🏅 <b>${escapeTelegramHtml(person.full_name)}</b> — личный рекорд на ${distance.label}: ` +
    `<b>${formatRaceTime(result.official_time_seconds)}</b>${improvement}\n${escapeTelegramHtml(result.name)}`;
  await sendTelegramMessage(person.telegram_chat_id, text);
}

export async function resultsRoutes(app: FastifyInstance) {
  app.get("/api/results/athletes/:id", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["athlete", "trainer"]);
    const athleteId = parseId((request.params as { id: string }).id);
    if (!athleteId || !(await canView(request, athleteId))) {
      return reply.code(404).send({ message: "Спортсмен не найден" });
    }
    const data = await getAthleteResults(athleteId);
    return { ...data, canEdit: await canEdit(request, athleteId) };
  });

  app.post("/api/results/athletes/:id", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["athlete", "trainer"]);
    const athleteId = parseId((request.params as { id: string }).id);
    if (!athleteId || !(await canEdit(request, athleteId))) {
      return reply.code(403).send({ message: "Нет доступа" });
    }
    const input = raceResultSchema.parse(request.body);
    const result = await insertRaceResult(athleteId, request.user.id, input);
    // тренер сам в курсе того, что записал — уведомляем, только если записал спортсмен
    if (request.user.role === "athlete") await notifyCoachAboutRecord(result).catch((error) => request.log.warn({ err: error }, "record notification failed"));
    return { result };
  });

  app.put("/api/results/:id", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["athlete", "trainer"]);
    const resultId = parseId((request.params as { id: string }).id);
    const owner = resultId ? await getRaceResultOwner(resultId) : null;
    if (!resultId || !owner || !(await canEdit(request, owner.userId))) {
      return reply.code(404).send({ message: "Результат не найден" });
    }
    const input = raceResultSchema.parse(request.body);
    const result = await updateRaceResult(resultId, input);
    if (result && request.user.role === "athlete") {
      await notifyCoachAboutRecord(result).catch((error) => request.log.warn({ err: error }, "record notification failed"));
    }
    return { result };
  });

  app.delete("/api/results/:id", { preHandler: requireAuth }, async (request, reply) => {
    requireRole(request, ["athlete", "trainer"]);
    const resultId = parseId((request.params as { id: string }).id);
    const owner = resultId ? await getRaceResultOwner(resultId) : null;
    if (!resultId || !owner || !(await canEdit(request, owner.userId))) {
      return reply.code(404).send({ message: "Результат не найден" });
    }
    await deleteRaceResult(resultId);
    return { ok: true };
  });
}
