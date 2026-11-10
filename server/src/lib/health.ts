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
  return {
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
