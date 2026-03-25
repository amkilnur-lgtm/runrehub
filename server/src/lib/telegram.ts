import { config } from "../config.js";

function escapeTelegramHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function isTelegramConfigured() {
  return Boolean(config.TELEGRAM_BOT_TOKEN);
}

export async function sendTelegramMessage(chatId: string, text: string) {
  if (!config.TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_NOT_CONFIGURED");
  }

  const response = await fetch(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: false
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`TELEGRAM_SEND_FAILED: ${body.slice(0, 500)}`);
  }
}

export function formatTelegramWorkoutMessage(input: {
  athleteName: string;
  distanceMeters: number;
  averageSpeed: number | null;
  averageHeartrate: number | null;
  workoutId: number;
}) {
  const athleteName = escapeTelegramHtml(input.athleteName);
  const distanceKm = Number.isFinite(input.distanceMeters)
    ? (input.distanceMeters / 1000).toFixed(2)
    : "0.00";

  let paceText = "—";
  if (input.averageSpeed && Number.isFinite(input.averageSpeed) && input.averageSpeed > 0) {
    const rawSeconds = 1000 / input.averageSpeed;
    const roundedSeconds = Math.round(rawSeconds);
    const minutes = Math.floor(roundedSeconds / 60);
    const seconds = roundedSeconds % 60;
    paceText = `${minutes}:${String(seconds).padStart(2, "0")}/км`;
  }

  const heartRateText =
    input.averageHeartrate && Number.isFinite(input.averageHeartrate)
      ? `${Math.round(input.averageHeartrate)} уд/мин`
      : "—";

  const workoutUrl = `${config.APP_URL.replace(/\/$/, "")}/trainer/workouts/${input.workoutId}`;

  return [
    `<b>${athleteName} побегала</b>`,
    "",
    `Дистанция: <b>${distanceKm} км</b>`,
    `Средний темп: <b>${escapeTelegramHtml(paceText)}</b>`,
    `Средний пульс: <b>${escapeTelegramHtml(heartRateText)}</b>`,
    "",
    `<a href="${escapeTelegramHtml(workoutUrl)}">Посмотреть тренировку</a>`
  ].join("\n");
}
