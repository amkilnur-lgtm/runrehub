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
