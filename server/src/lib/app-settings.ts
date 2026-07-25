import { pool } from "./db.js";
import { config } from "../config.js";

const FORCE_INTERVAL_KEY = "intervals_force_interval_minutes";
const MIN_FORCE_MINUTES = 5;
const MAX_FORCE_MINUTES = 24 * 60;

export async function getForceIntervalMinutes(): Promise<number> {
  const { rows } = await pool.query(`select value from app_settings where key = $1`, [
    FORCE_INTERVAL_KEY
  ]);
  const stored = rows[0] ? Number(rows[0].value) : NaN;
  if (Number.isFinite(stored) && stored >= MIN_FORCE_MINUTES && stored <= MAX_FORCE_MINUTES) {
    return stored;
  }
  return config.INTERVALS_FORCE_INTERVAL_MINUTES;
}

export async function setForceIntervalMinutes(minutes: number): Promise<number> {
  const clamped = Math.min(MAX_FORCE_MINUTES, Math.max(MIN_FORCE_MINUTES, Math.round(minutes)));
  await pool.query(
    `
      insert into app_settings (key, value, updated_at) values ($1, $2, now())
      on conflict (key) do update set value = excluded.value, updated_at = now()
    `,
    [FORCE_INTERVAL_KEY, String(clamped)]
  );
  return clamped;
}

const TELEGRAM_CHATS_KEY = "telegram_bot_chats";

// Chat_id, которым разрешено управлять ботом (форс всех) помимо привязанных тренеров
export async function getAuthorizedTelegramChats(): Promise<string[]> {
  const { rows } = await pool.query(`select value from app_settings where key = $1`, [
    TELEGRAM_CHATS_KEY
  ]);
  return rows[0]?.value
    ? String(rows[0].value)
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean)
    : [];
}

export async function setAuthorizedTelegramChats(raw: string): Promise<string[]> {
  const list = raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  await pool.query(
    `
      insert into app_settings (key, value, updated_at) values ($1, $2, now())
      on conflict (key) do update set value = excluded.value, updated_at = now()
    `,
    [TELEGRAM_CHATS_KEY, list.join(",")]
  );
  return list;
}
