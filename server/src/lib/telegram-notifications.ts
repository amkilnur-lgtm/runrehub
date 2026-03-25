import { FastifyBaseLogger } from "fastify";

import { config } from "../config.js";
import { pool } from "./db.js";
import { addStravaEvent } from "./strava-events.js";
import { formatTelegramWorkoutMessage, isTelegramConfigured, sendTelegramMessage } from "./telegram.js";

type PendingTelegramJob = {
  id: number;
  workout_id: number;
  coach_user_id: number;
  chat_id: string;
  athlete_name: string;
  distance_meters: number;
  average_speed: number | null;
  average_heartrate: number | null;
};

const MAX_TELEGRAM_ATTEMPTS = 5;

function logTelegramEvent(
  level: "info" | "warn" | "error",
  message: string,
  details?: Record<string, unknown>
) {
  addStravaEvent({
    source: "system",
    level,
    message,
    details
  });
}

export async function enqueueNewWorkoutTelegramNotification(workoutId: number) {
  const { rows } = await pool.query(
    `
      insert into telegram_notification_jobs (workout_id, coach_user_id, kind)
      select w.id, athlete.coach_id, 'new_workout'
      from workouts w
      join users athlete on athlete.id = w.user_id
      join users coach on coach.id = athlete.coach_id
      where w.id = $1
        and athlete.coach_id is not null
        and coach.role = 'trainer'
        and coach.telegram_notifications_enabled = true
        and nullif(trim(coach.telegram_chat_id), '') is not null
      on conflict (workout_id, coach_user_id, kind) do nothing
      returning id
    `,
    [workoutId]
  );

  if (rows[0]) {
    logTelegramEvent("info", "telegram notification queued", { workoutId });
    return true;
  }

  return false;
}

async function claimPendingJob() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { rows } = await client.query<PendingTelegramJob>(
      `
        select
          job.id,
          job.workout_id,
          job.coach_user_id,
          coach.telegram_chat_id as chat_id,
          athlete.full_name as athlete_name,
          workout.distance_meters,
          workout.average_speed,
          workout.average_heartrate
        from telegram_notification_jobs job
        join workouts workout on workout.id = job.workout_id
        join users athlete on athlete.id = workout.user_id
        join users coach on coach.id = job.coach_user_id
        where (
          job.status = 'pending'
          or (job.status = 'failed' and job.attempts < $1)
          or (
            job.status = 'processing'
            and job.attempts < $1
            and job.updated_at < now() - interval '10 minutes'
          )
        )
          and coach.telegram_notifications_enabled = true
          and nullif(trim(coach.telegram_chat_id), '') is not null
        order by job.created_at asc
        limit 1
        for update skip locked
      `,
      [MAX_TELEGRAM_ATTEMPTS]
    );

    const job = rows[0];
    if (!job) {
      await client.query("COMMIT");
      return null;
    }

    await client.query(
      `
        update telegram_notification_jobs
        set status = 'processing',
            attempts = attempts + 1,
            updated_at = now(),
            last_error = null
        where id = $1
      `,
      [job.id]
    );

    await client.query("COMMIT");
    return job;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function processPendingTelegramNotifications(logger?: FastifyBaseLogger) {
  if (!isTelegramConfigured()) {
    return { processed: 0, delivered: 0, skipped: true as const };
  }

  let processed = 0;
  let delivered = 0;

  while (true) {
    const job = await claimPendingJob();
    if (!job) {
      break;
    }

    processed += 1;

    try {
      const message = formatTelegramWorkoutMessage({
        athleteName: job.athlete_name,
        distanceMeters: Number(job.distance_meters ?? 0),
        averageSpeed:
          typeof job.average_speed === "number" ? job.average_speed : job.average_speed ?? null,
        averageHeartrate:
          typeof job.average_heartrate === "number"
            ? job.average_heartrate
            : job.average_heartrate ?? null,
        workoutId: job.workout_id
      });

      await sendTelegramMessage(job.chat_id, message);

      await pool.query(
        `
          update telegram_notification_jobs
          set status = 'sent',
              sent_at = now(),
              updated_at = now(),
              last_error = null
          where id = $1
        `,
        [job.id]
      );

      delivered += 1;
      logger?.info({ jobId: job.id, workoutId: job.workout_id }, "telegram notification sent");
      logTelegramEvent("info", "telegram notification sent", {
        jobId: job.id,
        workoutId: job.workout_id
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      await pool.query(
        `
          update telegram_notification_jobs
          set status = 'failed',
              updated_at = now(),
              last_error = $2
          where id = $1
        `,
        [job.id, errorMessage.slice(0, 1000)]
      );

      logger?.error(
        { err: error, jobId: job.id, workoutId: job.workout_id },
        "telegram notification failed"
      );
      logTelegramEvent("error", "telegram notification failed", {
        jobId: job.id,
        workoutId: job.workout_id,
        error: errorMessage
      });
    }
  }

  return { processed, delivered, skipped: false as const };
}

function escapeTelegramHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export async function sendTelegramTestMessage(chatId: string, trainerName: string) {
  if (!isTelegramConfigured()) {
    throw new Error("TELEGRAM_NOT_CONFIGURED");
  }

  await sendTelegramMessage(
    chatId,
    [
      `Тестовое уведомление для тренера <b>${escapeTelegramHtml(trainerName)}</b>.`,
      "Если это сообщение пришло, интеграция Telegram настроена корректно.",
      `<a href="${escapeTelegramHtml(config.APP_URL.replace(/\/$/, ""))}/admin">Открыть админку</a>`
    ].join("\n")
  );
}
