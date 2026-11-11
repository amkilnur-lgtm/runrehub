import { FastifyInstance } from "fastify";
import { z } from "zod";

import { removeAvatarFile, saveAvatarFromDataUrl } from "../lib/avatar-storage.js";
import { pool } from "../lib/db.js";
import { labFileUrl } from "../lib/lab-files.js";
import { deleteAllLabFiles, deleteLabFile, MAX_LAB_BYTES, readLabFile, saveLabFile } from "../lib/lab-files.js";
import { addLabEntry, cycleEndSchema, cyclePeriodSchema, cycleSettingsSchema, getHealth, healthSettingsSchema, labEntrySchema, supplementSchema } from "../lib/health.js";
import { achievementSchema, getPublicProfile, publicProfileSchema, savePublicProfile } from "../lib/public-profile.js";
import { clearAuthCookie, loadCurrentUser, requireAuth, setAuthCookie, verifyPassword } from "../lib/auth.js";
import { findUserIdForTelegram, linkTelegramToUser, verifyTelegramInitData } from "../lib/telegram-auth.js";
import { config } from "../config.js";
import { AuthUser } from "../types.js";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  // initData Mini App: если вход паролем идёт изнутри Telegram — заодно привязываем Telegram
  telegramInitData: z.string().max(4096).optional()
});

const telegramLoginSchema = z.object({
  initData: z.string().min(1).max(4096)
});

function verifiedTelegramUser(initData: string | undefined) {
  if (!initData || !config.TELEGRAM_BOT_TOKEN) {
    return null;
  }
  return verifyTelegramInitData(initData, config.TELEGRAM_BOT_TOKEN);
}

export const birthdaySchema = z
  .object({
    day: z.number().int().min(1).max(31).nullable(),
    month: z.number().int().min(1).max(12).nullable(),
    hidden: z.boolean().default(false)
  })
  .refine((value) => (value.day === null) === (value.month === null), { message: "Укажите день и месяц" })
  .refine((value) => value.day === null || value.day <= new Date(2024, value.month!, 0).getDate(), {
    message: "Такой даты нет"
  });

const avatarUploadSchema = z.object({
  imageDataUrl: z.string().min(1)
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
      `select id, username, full_name, avatar_url, role, coach_id, password_hash from users where username = $1`,
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
      avatarUrl: user.avatar_url,
      role: user.role,
      coachId: user.coach_id
    };

    const telegramUser = verifiedTelegramUser(body.telegramInitData);
    if (telegramUser) {
      await linkTelegramToUser(authUser.id, telegramUser);
    }

    await setAuthCookie(reply, authUser);
    return { user: authUser };
  });

  app.post(
    "/api/auth/telegram",
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute"
        }
      }
    },
    async (request, reply) => {
      const body = telegramLoginSchema.parse(request.body);
      const telegramUser = verifiedTelegramUser(body.initData);
      if (!telegramUser) {
        return reply.code(401).send({ message: "Не удалось проверить данные Telegram" });
      }

      const userId = await findUserIdForTelegram(telegramUser);
      const user = userId ? await loadCurrentUser(userId) : null;
      if (!user) {
        return reply.code(404).send({ message: "Этот Telegram пока не привязан к аккаунту", code: "TELEGRAM_NOT_LINKED" });
      }

      await setAuthCookie(reply, user);
      return { user };
    }
  );

  // День рождения — только день и месяц; hidden — не показывать клубу (тренер видит всегда)
  app.get("/api/auth/birthday", { preHandler: requireAuth }, async (request) => {
    const { rows } = await pool.query(
      `select birthday_day, birthday_month, birthday_hidden from users where id = $1`,
      [request.user.id]
    );
    const row = rows[0];
    return {
      day: row?.birthday_day ?? null,
      month: row?.birthday_month ?? null,
      hidden: Boolean(row?.birthday_hidden)
    };
  });

  app.put("/api/auth/birthday", { preHandler: requireAuth }, async (request) => {
    const body = birthdaySchema.parse(request.body);
    await pool.query(
      `update users set birthday_day = $2, birthday_month = $3, birthday_hidden = $4 where id = $1`,
      [request.user.id, body.day, body.month, body.hidden]
    );
    return { ok: true, ...body };
  });

  // «Мой профиль · видно клубу»
  app.get("/api/auth/profile", { preHandler: requireAuth }, async (request) => getPublicProfile(request.user.id));

  app.put("/api/auth/profile", { preHandler: requireAuth }, async (request) =>
    savePublicProfile(request.user.id, publicProfileSchema.parse(request.body))
  );

  app.post("/api/auth/achievements", { preHandler: requireAuth }, async (request, reply) => {
    const body = achievementSchema.parse(request.body);
    const { rows } = await pool.query(`select count(*)::int as n from athlete_achievements where user_id = $1`, [request.user.id]);
    if (rows[0].n >= 10) return reply.code(400).send({ message: "Не больше 10 достижений" });
    await pool.query(`insert into athlete_achievements (user_id, title, year) values ($1, $2, $3)`, [request.user.id, body.title, body.year]);
    return getPublicProfile(request.user.id);
  });

  app.delete("/api/auth/achievements/:id", { preHandler: requireAuth }, async (request) => {
    const id = Number((request.params as { id: string }).id);
    await pool.query(`delete from athlete_achievements where id = $1 and user_id = $2`, [id, request.user.id]);
    return getPublicProfile(request.user.id);
  });

  // «Здоровье»: анализы и витамины. Без согласия — только чтение настроек
  // ссылки на файлы анализов — подписанные, на 30 минут: открываются и во встроенном браузере Telegram
  const healthWithLinks = async (userId: number) => {
    const health = await getHealth(userId);
    return { ...health, lab_files: health.lab_files.map((file) => ({ ...file, url: labFileUrl(app, file.id) })) };
  };

  app.get("/api/auth/health", { preHandler: requireAuth }, async (request) => healthWithLinks(request.user.id));

  app.put("/api/auth/health/settings", { preHandler: requireAuth }, async (request) => {
    const body = healthSettingsSchema.parse(request.body);
    if (body.consent === true) await pool.query(`update users set health_consent_at = coalesce(health_consent_at, now()) where id = $1`, [request.user.id]);
    if (body.consent === false) {
      // отзыв согласия — удаляем всё о здоровье
      await pool.query(`delete from lab_results where user_id = $1`, [request.user.id]);
      await deleteAllLabFiles(request.user.id);
      await pool.query(`delete from supplements where user_id = $1`, [request.user.id]);
      await pool.query(`delete from cycle_periods where user_id = $1`, [request.user.id]);
      await pool.query(`update users set cycle_enabled = false, cycle_share_coach = false where id = $1`, [request.user.id]);
      await pool.query(`update users set health_consent_at = null where id = $1`, [request.user.id]);
    }
    if (body.share_coach !== undefined) await pool.query(`update users set health_share_coach = $2 where id = $1`, [request.user.id, body.share_coach]);
    return healthWithLinks(request.user.id);
  });

  const requireConsent = async (userId: number) => {
    const { rows } = await pool.query(`select health_consent_at from users where id = $1`, [userId]);
    return Boolean(rows[0]?.health_consent_at);
  };

  app.post("/api/auth/health/labs", { preHandler: requireAuth }, async (request, reply) => {
    if (!(await requireConsent(request.user.id))) return reply.code(403).send({ message: "Сначала подтвердите согласие" });
    await addLabEntry(request.user.id, labEntrySchema.parse(request.body));
    return healthWithLinks(request.user.id);
  });

  app.delete("/api/auth/health/labs/:id", { preHandler: requireAuth }, async (request) => {
    await pool.query(`delete from lab_results where id = $1 and user_id = $2`, [Number((request.params as { id: string }).id), request.user.id]);
    return healthWithLinks(request.user.id);
  });

  // Анализы файлом: тело — сам файл (фото или PDF), дата и подпись — в query, имя — в заголовке
  app.post("/api/auth/health/lab-files", { preHandler: requireAuth, bodyLimit: MAX_LAB_BYTES + 1024 }, async (request, reply) => {
    if (!(await requireConsent(request.user.id))) return reply.code(403).send({ message: "Сначала подтвердите согласие" });
    const q = z
      .object({ taken_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), title: z.string().trim().max(80).optional() })
      .parse(request.query);
    const mime = String(request.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
    if (!Buffer.isBuffer(request.body)) return reply.code(400).send({ message: "Можно фото или PDF" });
    const rawName = String(request.headers["x-file-name"] ?? "");
    let originalName: string | null = null;
    try {
      originalName = rawName ? decodeURIComponent(rawName).slice(0, 120) : null;
    } catch {
      originalName = null;
    }
    await saveLabFile(request.user.id, { buffer: request.body, mime, takenOn: q.taken_on, title: q.title || null, originalName });
    return healthWithLinks(request.user.id);
  });

  app.delete("/api/auth/health/lab-files/:id", { preHandler: requireAuth }, async (request) => {
    await deleteLabFile(request.user.id, Number((request.params as { id: string }).id));
    return healthWithLinks(request.user.id);
  });

  app.get("/api/lab-file", async (request, reply) => {
    let payload: { kind?: string; fileId?: number };
    try {
      payload = app.jwt.verify(String((request.query as { t?: unknown }).t ?? ""));
    } catch {
      return reply.code(404).send({ message: "Ссылка устарела — откройте файл ещё раз из профиля" });
    }
    if (payload.kind !== "lab" || !Number.isSafeInteger(payload.fileId)) return reply.code(404).send({ message: "Ссылка устарела" });
    const file = await readLabFile(payload.fileId!);
    if (!file) return reply.code(404).send({ message: "Файл не найден" });
    return reply
      .header("Content-Type", file.mime)
      .header("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`)
      .header("Cache-Control", "private, no-store")
      .header("X-Robots-Tag", "noindex")
      .send(file.buffer);
  });

  app.put("/api/auth/health/cycle/settings", { preHandler: requireAuth }, async (request, reply) => {
    if (!(await requireConsent(request.user.id))) return reply.code(403).send({ message: "Сначала подтвердите согласие" });
    const body = cycleSettingsSchema.parse(request.body);
    if (body.enabled !== undefined) await pool.query(`update users set cycle_enabled = $2 where id = $1`, [request.user.id, body.enabled]);
    if (body.share_coach !== undefined) await pool.query(`update users set cycle_share_coach = $2 where id = $1`, [request.user.id, body.share_coach]);
    if (body.hormonal !== undefined) await pool.query(`update users set cycle_hormonal = $2 where id = $1`, [request.user.id, body.hormonal]);
    return healthWithLinks(request.user.id);
  });

  app.post("/api/auth/health/cycle", { preHandler: requireAuth }, async (request, reply) => {
    if (!(await requireConsent(request.user.id))) return reply.code(403).send({ message: "Сначала подтвердите согласие" });
    const body = cyclePeriodSchema.parse(request.body);
    if (body.started_on > new Date().toISOString().slice(0, 10)) return reply.code(400).send({ message: "Дата в будущем" });
    await pool.query(
      `insert into cycle_periods (user_id, started_on) values ($1, $2) on conflict (user_id, started_on) do nothing`,
      [request.user.id, body.started_on]
    );
    return healthWithLinks(request.user.id);
  });

  app.put("/api/auth/health/cycle/:id/end", { preHandler: requireAuth }, async (request) => {
    const body = cycleEndSchema.parse(request.body);
    await pool.query(`update cycle_periods set ended_on = $3 where id = $1 and user_id = $2 and started_on <= $3`, [
      Number((request.params as { id: string }).id),
      request.user.id,
      body.ended_on
    ]);
    return healthWithLinks(request.user.id);
  });

  app.delete("/api/auth/health/cycle/:id", { preHandler: requireAuth }, async (request) => {
    await pool.query(`delete from cycle_periods where id = $1 and user_id = $2`, [Number((request.params as { id: string }).id), request.user.id]);
    return healthWithLinks(request.user.id);
  });

  app.post("/api/auth/health/supplements", { preHandler: requireAuth }, async (request, reply) => {
    if (!(await requireConsent(request.user.id))) return reply.code(403).send({ message: "Сначала подтвердите согласие" });
    const body = supplementSchema.parse(request.body);
    await pool.query(`insert into supplements (user_id, name, dose) values ($1, $2, $3)`, [request.user.id, body.name, body.dose]);
    return healthWithLinks(request.user.id);
  });

  app.put("/api/auth/health/supplements/:id/stop", { preHandler: requireAuth }, async (request) => {
    await pool.query(`update supplements set stopped_on = current_date where id = $1 and user_id = $2 and stopped_on is null`, [
      Number((request.params as { id: string }).id),
      request.user.id
    ]);
    return healthWithLinks(request.user.id);
  });

  app.delete("/api/auth/health/supplements/:id", { preHandler: requireAuth }, async (request) => {
    await pool.query(`delete from supplements where id = $1 and user_id = $2`, [Number((request.params as { id: string }).id), request.user.id]);
    return healthWithLinks(request.user.id);
  });

  app.post("/api/auth/logout", async (_request, reply) => {
    clearAuthCookie(reply);
    return { ok: true };
  });

  app.get("/api/auth/me", async (request, reply) => {
    try {
      await requireAuth(request);
    } catch (error) {
      // сбой базы — не повод разлогинивать: пусть уйдёт 500 через общий обработчик
      const code = (error as { code?: string; statusCode?: number }).code ?? "";
      const isAuthError = code.startsWith("FST_JWT_") || (error as { statusCode?: number }).statusCode === 401;
      if (!isAuthError) {
        throw error;
      }
      clearAuthCookie(reply);
      return reply.code(401).send({ message: "Не авторизован" });
    }
    return { user: request.user };
  });

  app.put("/api/auth/avatar", { preHandler: requireAuth }, async (request, reply) => {
    const body = avatarUploadSchema.parse(request.body);
    const currentAvatarUrl = request.user.avatarUrl;
    const nextAvatarUrl = await saveAvatarFromDataUrl(request.user.id, body.imageDataUrl);

    try {
      await pool.query(`update users set avatar_url = $2 where id = $1`, [request.user.id, nextAvatarUrl]);
      await removeAvatarFile(currentAvatarUrl);
    } catch (error) {
      await removeAvatarFile(nextAvatarUrl);
      throw error;
    }

    const nextUser: AuthUser = {
      ...request.user,
      avatarUrl: nextAvatarUrl
    };
    await setAuthCookie(reply, nextUser);
    return { user: nextUser };
  });

  app.delete("/api/auth/avatar", { preHandler: requireAuth }, async (request, reply) => {
    const currentAvatarUrl = request.user.avatarUrl;

    await pool.query(`update users set avatar_url = null where id = $1`, [request.user.id]);
    await removeAvatarFile(currentAvatarUrl);

    const nextUser: AuthUser = {
      ...request.user,
      avatarUrl: null
    };
    await setAuthCookie(reply, nextUser);
    return { user: nextUser };
  });
}
