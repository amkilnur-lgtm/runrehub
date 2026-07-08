import { pool } from "../lib/db.js";
import { analyzeStaleWorkouts } from "../lib/workout-analysis.js";

const limitArg = Number(process.argv[2] ?? 50);
const limit = Number.isFinite(limitArg) && limitArg > 0 ? Math.min(Math.floor(limitArg), 500) : 50;

try {
  const result = await analyzeStaleWorkouts(limit);
  console.log(`Analyzed workouts: ${result.analyzed}/${result.selected}`);
} finally {
  await pool.end();
}
