import { z } from "zod";

import { pool } from "./db.js";

// Разряды и звания ЕВСК (приказ Минспорта №173 от 03.03.2025): звания — пожизненно,
// КМС — 3 года, взрослые и юношеские разряды — 2 года. Истёкший показываем с годом: «КМС (2019)».
export const SPORT_RANKS = ["МСМК", "МС", "КМС", "I", "II", "III", "I юн", "II юн", "III юн"] as const;
const RANK_YEARS: Record<string, number | null> = { МСМК: null, МС: null, КМС: 3, I: 2, II: 2, III: 2, "I юн": 2, "II юн": 2, "III юн": 2 };

export function rankLabel(rank: string | null, discipline: string | null, year: number | null) {
  if (!rank) return null;
  const name = /^(I|II|III)( юн)?$/.test(rank) ? `${rank.replace(" юн", "")} ${rank.includes("юн") ? "юн. разряд" : "разряд"}` : rank;
  const lifetime = RANK_YEARS[rank] ?? null;
  const expired = year && lifetime ? new Date().getFullYear() - year >= lifetime : false;
  return `${name}${discipline ? ` · ${discipline}` : ""}${expired ? ` (${year})` : ""}`;
}

export const publicProfileSchema = z.object({
  about: z.string().trim().max(500).nullable(),
  sport_rank: z.enum(SPORT_RANKS).nullable(),
  sport_rank_discipline: z.string().trim().max(60).nullable(),
  sport_rank_year: z.number().int().min(1950).max(2100).nullable(),
  recovering: z.boolean()
});

export const achievementSchema = z.object({
  title: z.string().trim().min(2).max(140),
  year: z.number().int().min(1950).max(2100).nullable()
});

export async function getPublicProfile(userId: number) {
  const [user, achievements] = await Promise.all([
    pool.query(
      `select about, sport_rank, sport_rank_discipline, sport_rank_year, recovering,
              birthday_day, birthday_month, birthday_hidden
       from users where id = $1`,
      [userId]
    ),
    pool.query(`select id, title, year from athlete_achievements where user_id = $1 order by year desc nulls last, id desc`, [userId])
  ]);
  const row = user.rows[0] ?? {};
  return {
    about: row.about ?? null,
    sport_rank: row.sport_rank ?? null,
    sport_rank_discipline: row.sport_rank_discipline ?? null,
    sport_rank_year: row.sport_rank_year ?? null,
    rank_label: rankLabel(row.sport_rank ?? null, row.sport_rank_discipline ?? null, row.sport_rank_year ?? null),
    recovering: Boolean(row.recovering),
    birthday: row.birthday_day ? { day: Number(row.birthday_day), month: Number(row.birthday_month), hidden: Boolean(row.birthday_hidden) } : null,
    achievements: achievements.rows.map((a) => ({ id: Number(a.id), title: String(a.title), year: a.year ?? null }))
  };
}

export async function savePublicProfile(userId: number, body: z.infer<typeof publicProfileSchema>) {
  await pool.query(
    `update users set about = $2, sport_rank = $3, sport_rank_discipline = $4, sport_rank_year = $5, recovering = $6 where id = $1`,
    [userId, body.about || null, body.sport_rank, body.sport_rank ? body.sport_rank_discipline || null : null, body.sport_rank ? body.sport_rank_year : null, body.recovering]
  );
  return getPublicProfile(userId);
}
