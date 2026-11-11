import { listLabFiles } from "./lab-files.js";
import { z } from "zod";

import { pool } from "./db.js";

// Анализы и витамины. Значения — как в бланке лаборатории, без оценок «норма / не норма»:
// референсы у лабораторий разные, а спортивные «цели» — мнение отдельных специалистов.
export const labEntrySchema = z.object({
  taken_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  values: z
    .array(
      z.object({
        marker: z.string().trim().min(1).max(60),
        value: z.number().finite().min(0).max(100000),
        unit: z.string().trim().max(20).nullable()
      })
    )
    .min(1)
    .max(20)
});

export const supplementSchema = z.object({
  name: z.string().trim().min(2).max(80),
  dose: z.string().trim().max(80).nullable()
});

export const healthSettingsSchema = z.object({
  consent: z.boolean().optional(),
  share_coach: z.boolean().optional()
});

function day(value: Date | string) {
  if (typeof value === "string") return value.slice(0, 10);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export async function getHealth(userId: number) {
  const [user, labs, supps] = await Promise.all([
    pool.query(`select health_consent_at, health_share_coach from users where id = $1`, [userId]),
    pool.query(`select id, taken_on, marker, value, unit from lab_results where user_id = $1 order by taken_on desc, id asc`, [userId]),
    pool.query(
      `select id, name, dose, started_on, stopped_on from supplements where user_id = $1
       order by (stopped_on is null) desc, coalesce(stopped_on, started_on) desc, id desc`,
      [userId]
    )
  ]);
  const sessions = new Map<string, { taken_on: string; values: { id: number; marker: string; value: number; unit: string | null }[] }>();
  for (const row of labs.rows) {
    const key = day(row.taken_on);
    if (!sessions.has(key)) sessions.set(key, { taken_on: key, values: [] });
    sessions.get(key)!.values.push({ id: Number(row.id), marker: String(row.marker), value: Number(row.value), unit: row.unit ?? null });
  }
  const cycle = await getCycle(userId);
  return {
    cycle,
    lab_files: await listLabFiles(userId),
    consent_at: user.rows[0]?.health_consent_at ?? null,
    share_coach: Boolean(user.rows[0]?.health_share_coach ?? true),
    labs: [...sessions.values()],
    supplements: supps.rows.map((row) => ({
      id: Number(row.id),
      name: String(row.name),
      dose: row.dose ?? null,
      started_on: day(row.started_on),
      stopped_on: row.stopped_on ? day(row.stopped_on) : null
    }))
  };
}

export async function addLabEntry(userId: number, body: z.infer<typeof labEntrySchema>) {
  for (const item of body.values) {
    await pool.query(`insert into lab_results (user_id, taken_on, marker, value, unit) values ($1, $2, $3, $4, $5)`, [
      userId,
      body.taken_on,
      item.marker,
      item.value,
      item.unit
    ]);
  }
}

// ---- Цикл ----
export const cycleSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  share_coach: z.boolean().optional(),
  hormonal: z.boolean().optional()
});
export const cyclePeriodSchema = z.object({ started_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
export const cycleEndSchema = z.object({ ended_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

// Сигнал без диагноза: месячных нет больше 90 дней и нет гормональной контрацепции —
// мягко предлагаем поговорить с врачом (IOC 2023: пропуск циклов — признак REDs).
const NO_PERIOD_ALERT_DAYS = 90;

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

export async function getCycle(userId: number) {
  const [user, periods] = await Promise.all([
    pool.query(`select cycle_enabled, cycle_share_coach, cycle_hormonal from users where id = $1`, [userId]),
    pool.query(`select id, started_on, ended_on from cycle_periods where user_id = $1 order by started_on desc limit 12`, [userId])
  ]);
  const row = user.rows[0] ?? {};
  const list = periods.rows.map((p) => ({ id: Number(p.id), started_on: day(p.started_on), ended_on: p.ended_on ? day(p.ended_on) : null }));
  const today = day(new Date());
  // длины циклов — между соседними началами; разумные 15–90 дней
  const lengths = list
    .slice(0, -1)
    .map((p, i) => daysBetween(list[i + 1]!.started_on, p.started_on))
    .filter((n) => n >= 15 && n <= 90)
    .slice(0, 6);
  const avg = lengths.length ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length) : null;
  const last = list[0] ?? null;
  const dayOfCycle = last ? daysBetween(last.started_on, today) + 1 : null;
  const nextIn = last && avg ? avg - (dayOfCycle! - 1) : null;
  const noPeriodDays = last ? dayOfCycle! - 1 : null;
  return {
    enabled: Boolean(row.cycle_enabled),
    share_coach: Boolean(row.cycle_share_coach),
    hormonal: Boolean(row.cycle_hormonal),
    periods: list,
    day: dayOfCycle,
    avg_length: avg,
    next_in_days: nextIn,
    alert: Boolean(row.cycle_enabled && !row.cycle_hormonal && noPeriodDays !== null && noPeriodDays > NO_PERIOD_ALERT_DAYS)
  };
}
