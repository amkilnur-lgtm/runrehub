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

function formatDistanceKm(distanceMeters: number) {
  return Number.isFinite(distanceMeters) ? (distanceMeters / 1000).toFixed(2) : "0.00";
}

function formatDuration(seconds: number) {
  const totalSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function formatPace(averageSpeed: number | null) {
  if (!averageSpeed || !Number.isFinite(averageSpeed) || averageSpeed <= 0) {
    return "вЂ”";
  }

  const rawSeconds = 1000 / averageSpeed;
  const roundedSeconds = Math.round(rawSeconds);
  const minutes = Math.floor(roundedSeconds / 60);
  const seconds = roundedSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}/РєРј`;
}

function formatDateUtcPlus5(dateString: string) {
  const [year, month, day] = dateString.split("-").map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day, 5, 0, 0));

  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Yekaterinburg",
    day: "numeric",
    month: "long"
  }).format(utcDate);
}

export function formatTelegramWeeklyReportMessage(input: {
  athleteName: string;
  weekStart: string;
  totalDistanceMeters: number;
  totalMovingTimeSeconds: number;
  averageSpeed: number | null;
  averageHeartrate: number | null;
  workoutCount: number;
  zonePercentages: {
    under130: number;
    from130To150: number;
    from150To162: number;
    from162Plus: number;
  };
}) {
  const athleteName = escapeTelegramHtml(input.athleteName);
  const weekStartDate = new Date(`${input.weekStart}T00:00:00Z`);
  const weekEndDate = new Date(weekStartDate.getTime() + 6 * 24 * 60 * 60 * 1000);
  const weekRange = `${formatDateUtcPlus5(input.weekStart)} вЂ” ${formatDateUtcPlus5(
    weekEndDate.toISOString().slice(0, 10)
  )}`;
  const averageHeartRateText =
    input.averageHeartrate && Number.isFinite(input.averageHeartrate)
      ? `${Math.round(input.averageHeartrate)} СѓРґ/РјРёРЅ`
      : "вЂ”";

  return [
    `<b>${athleteName}</b>`,
    `РќРµРґРµР»СЏ: ${escapeTelegramHtml(weekRange)}`,
    "",
    `РўСЂРµРЅРёСЂРѕРІРѕРє: <b>${input.workoutCount}</b>`,
    `РћР±СЉС‘Рј: <b>${formatDistanceKm(input.totalDistanceMeters)} РєРј</b>`,
    `Р’СЂРµРјСЏ: <b>${escapeTelegramHtml(formatDuration(input.totalMovingTimeSeconds))}</b>`,
    `РЎСЂРµРґРЅРёР№ С‚РµРјРї: <b>${escapeTelegramHtml(formatPace(input.averageSpeed))}</b>`,
    `РЎСЂРµРґРЅРёР№ РїСѓР»СЊСЃ: <b>${escapeTelegramHtml(averageHeartRateText)}</b>`,
    "",
    "<b>Р—РѕРЅС‹ РїСѓР»СЊСЃР°</b>",
    `Р”Рѕ 130: <b>${input.zonePercentages.under130}%</b>`,
    `130вЂ“150: <b>${input.zonePercentages.from130To150}%</b>`,
    `150вЂ“162: <b>${input.zonePercentages.from150To162}%</b>`,
    `162+: <b>${input.zonePercentages.from162Plus}%</b>`
  ].join("\n");
}
