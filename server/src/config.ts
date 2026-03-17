import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "production"]).default("development"),
  APP_URL: z.string().default("http://localhost:3000"),
  PORT: z.coerce.number().default(3000),
  JWT_SECRET: z.string().min(8),
  ADMIN_USERNAME: z.string().default("admin"),
  ADMIN_PASSWORD: z.string().min(6),
  ADMIN_FULL_NAME: z.string().default("RunRehab Admin"),
  DATABASE_URL: z.string().min(1),
  STRAVA_CLIENT_ID: z.string().optional(),
  STRAVA_CLIENT_SECRET: z.string().optional(),
  STRAVA_WEBHOOK_VERIFY_TOKEN: z.string().default("change-me")
});

export const config = configSchema.parse(process.env);
