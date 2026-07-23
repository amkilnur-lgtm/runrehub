import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const configSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production"]).default("development"),
    APP_URL: z.string().default("http://localhost:3000"),
    APP_TIMEZONE: z.string().default("Europe/Moscow"),
    STRAVA_SYNC_INTERVAL_MINUTES: z.coerce.number().int().positive().default(15),
    // Как часто логиниться на intervals.icu и форсить activities-sync (подтяжка из COROS)
    INTERVALS_FORCE_INTERVAL_MINUTES: z.coerce.number().int().positive().default(60),
    PORT: z.coerce.number().default(3000),
    JWT_SECRET: z.string().min(8),
    ADMIN_USERNAME: z.string().default("admin"),
    ADMIN_PASSWORD: z.string().min(6),
    ADMIN_FULL_NAME: z.string().default("RunningRehab Admin"),
    DATABASE_URL: z.string().min(1),
    // Ключом зашифрованы api-ключи intervals.icu (имя осталось со времен Strava)
    STRAVA_TOKEN_ENCRYPTION_KEY: z.string().min(16).optional(),
    TELEGRAM_BOT_TOKEN: z.string().optional(),
    TELEGRAM_BOT_USERNAME: z.string().optional()
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === "production" && !value.STRAVA_TOKEN_ENCRYPTION_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["STRAVA_TOKEN_ENCRYPTION_KEY"],
        message: "STRAVA_TOKEN_ENCRYPTION_KEY is required in production"
      });
    }
  });

export const config = configSchema.parse(process.env);
