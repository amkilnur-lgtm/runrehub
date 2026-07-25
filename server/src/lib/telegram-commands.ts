import type { FastifyBaseLogger } from "fastify";

import { config } from "../config.js";
import { getAuthorizedTelegramChats } from "./app-settings.js";
import { pool } from "./db.js";
import { forceAndSyncAllAthletes } from "./intervals.js";
import {
  answerTelegramCallback,
  sendTelegramMessage,
  sendTelegramMessageWithButtons
} from "./telegram.js";

type TelegramUpdate = {
  message?: { chat?: { id: number }; text?: string };
  callback_query?: {
    id: string;
    data?: string;
    message?: { chat?: { id: number } };
  };
};

// Разрешаем управление только тренеру или админу с привязанным chat_id
// (либо TELEGRAM_ADMIN_CHAT_ID из окружения).
async function isAuthorizedChat(chatId: string): Promise<boolean> {
  if (config.TELEGRAM_ADMIN_CHAT_ID && config.TELEGRAM_ADMIN_CHAT_ID === chatId) {
    return true;
  }
  const allowed = await getAuthorizedTelegramChats();
  if (allowed.includes(chatId)) {
    return true;
  }
  const { rows } = await pool.query(
    `select 1 from users where telegram_chat_id = $1 and role in ('trainer', 'admin') limit 1`,
    [chatId]
  );
  return rows.length > 0;
}

const FORCE_BUTTON = [[{ text: "🔄 Форсировать всех", callback_data: "force_all" }]];

async function runForceAll(chatId: string, logger?: FastifyBaseLogger) {
  try {
    const result = await forceAndSyncAllAthletes();
    const lines = result.perAthlete.length
      ? result.perAthlete.map((a) => `• ${a.username}: +${a.imported}`).join("\n")
      : "новых тренировок нет";
    await sendTelegramMessageWithButtons(
      chatId,
      `✅ Готово. Форсировано аккаунтов: ${result.forced}, импортировано: ${result.imported}\n${lines}`,
      FORCE_BUTTON
    );
  } catch (error) {
    logger?.error({ err: error }, "telegram force-all failed");
    await sendTelegramMessage(chatId, "⚠️ Не удалось форсировать. Попробуй ещё раз.").catch(() => undefined);
  }
}

export async function handleTelegramUpdate(update: TelegramUpdate, logger?: FastifyBaseLogger) {
  // Нажатие inline-кнопки
  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = cq.message?.chat?.id ? String(cq.message.chat.id) : null;
    if (!chatId || !(await isAuthorizedChat(chatId))) {
      await answerTelegramCallback(cq.id, "Нет доступа");
      return;
    }
    if (cq.data === "force_all") {
      await answerTelegramCallback(cq.id, "Запускаю форс-синк всех…");
      await sendTelegramMessage(chatId, "⏳ Форсирую всех спортсменов, это займёт ~15 секунд…").catch(
        () => undefined
      );
      // не блокируем ответ вебхуку — работаем в фоне
      void runForceAll(chatId, logger);
    } else {
      await answerTelegramCallback(cq.id);
    }
    return;
  }

  // Текстовая команда
  const message = update.message;
  const chatId = message?.chat?.id ? String(message.chat.id) : null;
  const text = (message?.text ?? "").trim().toLowerCase();
  if (!chatId) {
    return;
  }
  if (text === "/start" || text === "/force" || text === "/sync" || text === "/id") {
    if (text === "/id") {
      // помогает узнать свой chat_id при настройке
      await sendTelegramMessage(chatId, `chat_id: <code>${chatId}</code>`).catch(() => undefined);
      return;
    }
    if (!(await isAuthorizedChat(chatId))) {
      await sendTelegramMessage(
        chatId,
        `Нет доступа. Твой chat_id: <code>${chatId}</code> — попроси админа привязать его к тренеру.`
      ).catch(() => undefined);
      return;
    }
    await sendTelegramMessageWithButtons(
      chatId,
      "Синхронизация intervals.icu. Нажми, чтобы форсировать подтяжку из COROS у всех спортсменов:",
      FORCE_BUTTON
    ).catch(() => undefined);
  }
}
