import { z } from "zod";

import { pool } from "./db.js";

export const workoutFeelingSchema = z
  .object({
    effort: z.enum(["easy", "normal", "hard"]).nullable().optional(),
    pain: z.enum(["none", "light"]).nullable().optional()
  })
  .refine((value) => value.effort !== undefined || value.pain !== undefined, {
    message: "Нечего сохранять"
  });

export type WorkoutFeeling = { effort: "easy" | "normal" | "hard" | null; pain: "none" | "light" | null };

export async function getWorkoutFeeling(workoutId: number): Promise<WorkoutFeeling> {
  const { rows } = await pool.query(`select effort, pain from workout_feelings where workout_id = $1`, [workoutId]);
  return { effort: rows[0]?.effort ?? null, pain: rows[0]?.pain ?? null };
}

// Частичное обновление: поле, которого нет в запросе, остаётся как было
export async function saveWorkoutFeeling(workoutId: number, userId: number, input: z.infer<typeof workoutFeelingSchema>) {
  const { rows } = await pool.query(
    `
      insert into workout_feelings (workout_id, user_id, effort, pain)
      values ($1, $2, $3, $4)
      on conflict (workout_id) do update set
        effort = case when $5 then excluded.effort else workout_feelings.effort end,
        pain = case when $6 then excluded.pain else workout_feelings.pain end,
        updated_at = now()
      returning effort, pain
    `,
    [workoutId, userId, input.effort ?? null, input.pain ?? null, input.effort !== undefined, input.pain !== undefined]
  );
  return { effort: rows[0].effort ?? null, pain: rows[0].pain ?? null } as WorkoutFeeling;
}
