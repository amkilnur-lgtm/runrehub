import { FastifyBaseLogger } from "fastify";

import { config } from "../config.js";
import { pool } from "./db.js";
import { addStravaEvent } from "./strava-events.js";
import {
  formatTelegramWeeklyReportMessage,
  formatTelegramWorkoutMessage,
  isTelegramConfigured,
  sendTelegramMessage
} from "./telegram.js";

type PendingTelegramJob = {
  id: number;
  kind: "new_workout" | "weekly_report";
  workout_id: number | null;
  coach_user_id: number;
  athlete_user_id: number | null;
  report_week_start: string | Date | null;
  chat_id: string;
  athlete_name: string;
  distance_meters: number | null;
  average_speed: number | null;
  average_heartrate: number | null;
};

type WeeklyReportData = {
  athleteName: string;
  workoutCount: number;
  totalDistanceMeters: number;
  totalMovingTimeSeconds: number;
  totalElevationGain: number;
  averageSpeed: number | null;
  averageHeartrate: number | null;
  zonePercentages: {
    under130: number;
    from130To150: number;
    from150To162: number;
    from162Plus: number;
  };
};

export type WeeklyReportPreviewItem = WeeklyReportData & {
  athleteUserId: number;
};

const MAX_TELEGRAM_ATTEMPTS = 5;
const WEEKLY_REPORT_UTC_OFFSET_MINUTES = 5 * 60;
const WEEKLY_REPORT_SEND_HOUR = 20;
const WEEKLY_REPORT_SEND_DAY = 0;

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

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function normalizeDateOnly(value: string | Date) {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      throw new Error("INVALID_REPORT_WEEK_START");
    }

    return value.toISOString().slice(0, 10);
  }

  const trimmed = value.trim();
  const dateOnlyMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateOnlyMatch) {
    return `${dateOnlyMatch[1]}-${dateOnlyMatch[2]}-${dateOnlyMatch[3]}`;
  }

  const parsed = new Date(trimmed);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error("INVALID_REPORT_WEEK_START");
  }

  return parsed.toISOString().slice(0, 10);
}

function parseDateInput(value: string | Date) {
  return new Date(`${normalizeDateOnly(value)}T00:00:00Z`);
}

function toUtcPlus5ShiftedDate(date: Date) {
  return new Date(date.getTime() + WEEKLY_REPORT_UTC_OFFSET_MINUTES * 60 * 1000);
}

function getUtcPlus5WeekStart(date: Date) {
  const shifted = toUtcPlus5ShiftedDate(date);
  const shiftedMidnightMs = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
    0,
    0,
    0,
    0
  );
  const day = shifted.getUTCDay();
  const daysFromMonday = day === 0 ? 6 : day - 1;
  const shiftedWeekStart = new Date(shiftedMidnightMs - daysFromMonday * DAY_MS);

  return new Date(shiftedWeekStart.getTime() - WEEKLY_REPORT_UTC_OFFSET_MINUTES * 60 * 1000);
}

export function getLatestEligibleWeeklyReportWeekStart(date = new Date()) {
  const currentWeekStart = getUtcPlus5WeekStart(date);
  const scheduledSendAt = new Date(
    currentWeekStart.getTime() + 6 * DAY_MS + WEEKLY_REPORT_SEND_HOUR * HOUR_MS
  );

  return date.getTime() >= scheduledSendAt.getTime()
    ? currentWeekStart
    : new Date(currentWeekStart.getTime() - 7 * DAY_MS);
}

function getWeekStartDateString(date: Date) {
  const shifted = toUtcPlus5ShiftedDate(date);
  return shifted.toISOString().slice(0, 10);
}

export function getWeeklyReportWeekStartForDate(value: string | Date) {
  return getWeekStartDateString(getUtcPlus5WeekStart(parseDateInput(value)));
}

export async function getWeeklyTelegramPreview(trainerId: number, weekDate: string | Date) {
  const { rows } = await pool.query<{
    full_name: string;
    telegram_chat_id: string | null;
  }>(
    `
      select full_name, telegram_chat_id
      from users
      where id = $1
        and role = 'trainer'
    `,
    [trainerId]
  );

  const trainer = rows[0];
  if (!trainer) {
    throw new Error("TRAINER_NOT_FOUND");
  }

  const reportWeekStart = getWeeklyReportWeekStartForDate(weekDate);
  const athleteResult = await pool.query<{ id: number }>(
    `
      select id
      from users
      where role = 'athlete'
        and coach_id = $1
      order by full_name asc
    `,
    [trainerId]
  );

  const reports: WeeklyReportPreviewItem[] = [];
  let skipped = 0;

  for (const athlete of athleteResult.rows) {
    const report = await buildWeeklyReportData(trainerId, athlete.id, reportWeekStart);
    if (!report) {
      skipped += 1;
      continue;
    }

    reports.push({
      athleteUserId: athlete.id,
      ...report
    });
  }

  return {
    trainerName: trainer.full_name,
    trainerHasChatId: Boolean(trainer.telegram_chat_id?.trim()),
    reportWeekStart,
    reports,
    skipped
  };
}

function getHeartRateZoneIndex(heartRate: number) {
  if (!Number.isFinite(heartRate) || heartRate <= 0) {
    return -1;
  }
  if (heartRate < 130) {
    return 0;
  }
  if (heartRate < 150) {
    return 1;
  }
  if (heartRate < 162) {
    return 2;
  }
  return 3;
}

function computeZonePercentages(zoneSeconds: number[]) {
  const totalSeconds = zoneSeconds.reduce((sum, value) => sum + value, 0);
  if (totalSeconds <= 0) {
    return {
      under130: 0,
      from130To150: 0,
      from150To162: 0,
      from162Plus: 0
    };
  }

  const rawPercentages = zoneSeconds.map((seconds) => (seconds / totalSeconds) * 100);
  const rounded = rawPercentages.map((value) => Math.round(value));
  const roundedTotal = rounded.reduce((sum, value) => sum + value, 0);
  if (roundedTotal !== 100) {
    const largestIndex = rawPercentages.reduce(
      (bestIndex, value, index, values) => (value > values[bestIndex]! ? index : bestIndex),
      0
    );
    rounded[largestIndex] += 100 - roundedTotal;
  }

  return {
    under130: rounded[0] ?? 0,
    from130To150: rounded[1] ?? 0,
    from150To162: rounded[2] ?? 0,
    from162Plus: rounded[3] ?? 0
  };
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

export async function enqueueWeeklyTelegramReports(now = new Date(), logger?: FastifyBaseLogger) {
  const weekStart = getLatestEligibleWeeklyReportWeekStart(now);
  const weekEnd = new Date(weekStart.getTime() + 7 * DAY_MS);
  const reportWeekStart = getWeekStartDateString(weekStart);

  const { rows } = await pool.query(
    `
      insert into telegram_notification_jobs (
        workout_id,
        coach_user_id,
        athlete_user_id,
        report_week_start,
        kind
      )
      select
        null,
        athlete.coach_id,
        athlete.id,
        $3::date,
        'weekly_report'
      from users athlete
      join users coach on coach.id = athlete.coach_id
      where athlete.role = 'athlete'
        and athlete.coach_id is not null
        and coach.role = 'trainer'
        and coach.telegram_notifications_enabled = true
        and nullif(trim(coach.telegram_chat_id), '') is not null
        and exists (
          select 1
          from workouts w
          where w.user_id = athlete.id
            and w.start_date >= $1
            and w.start_date < $2
        )
      on conflict do nothing
      returning id
    `,
    [weekStart.toISOString(), weekEnd.toISOString(), reportWeekStart]
  );

  if (rows.length > 0) {
    logger?.info({ queued: rows.length, reportWeekStart }, "telegram weekly reports queued");
    logTelegramEvent("info", "telegram weekly reports queued", {
      queued: rows.length,
      reportWeekStart
    });
  }

  return { queued: rows.length, reportWeekStart };
}

async function claimPendingJob() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { rows } = await client.query<PendingTelegramJob>(
      `
        with candidate_job as (
          select
            job.id,
            job.kind,
            job.workout_id,
            job.coach_user_id,
            job.athlete_user_id,
            job.report_week_start
          from telegram_notification_jobs job
          where (
            job.status = 'pending'
            or (job.status = 'failed' and job.attempts < $1)
            or (
              job.status = 'processing'
              and job.attempts < $1
              and job.updated_at < now() - interval '10 minutes'
            )
          )
          order by job.created_at asc
          limit 1
          for update skip locked
        )
        select
          job.id,
          job.kind,
          job.workout_id,
          job.coach_user_id,
          job.athlete_user_id,
          job.report_week_start,
          coach.telegram_chat_id as chat_id,
          coalesce(report_athlete.full_name, workout_athlete.full_name) as athlete_name,
          workout.distance_meters,
          workout.average_speed,
          workout.average_heartrate
        from candidate_job job
        join users coach on coach.id = job.coach_user_id
        left join workouts workout on workout.id = job.workout_id
        left join users workout_athlete on workout_athlete.id = workout.user_id
        left join users report_athlete on report_athlete.id = job.athlete_user_id
        where coach.telegram_notifications_enabled = true
          and nullif(trim(coach.telegram_chat_id), '') is not null
          and (
            (job.kind = 'new_workout' and workout.id is not null)
            or (job.kind = 'weekly_report' and report_athlete.id is not null and job.report_week_start is not null)
          )
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

async function buildWeeklyReportData(
  coachUserId: number,
  athleteUserId: number,
  reportWeekStart: string | Date
): Promise<WeeklyReportData | null> {
  const normalizedWeekStart = normalizeDateOnly(reportWeekStart);
  const weekStart = new Date(`${normalizedWeekStart}T00:00:00Z`);
  const weekEnd = new Date(weekStart.getTime() + 7 * DAY_MS);

  const summaryResult = await pool.query<{
    athlete_name: string;
    workout_count: number | string;
    total_distance_meters: number | string | null;
    total_moving_time_seconds: number | string | null;
    total_elevation_gain: number | string | null;
    weighted_heartrate_sum: number | string | null;
    heartrate_time_seconds: number | string | null;
  }>(
    `
      select
        athlete.full_name as athlete_name,
        count(w.id)::int as workout_count,
        coalesce(sum(coalesce(wc.corrected_distance_meters, w.distance_meters)), 0) as total_distance_meters,
        coalesce(sum(coalesce(wc.corrected_moving_time_seconds, w.moving_time_seconds)), 0) as total_moving_time_seconds,
        coalesce(sum(coalesce(wc.corrected_elevation_gain, w.elevation_gain)), 0) as total_elevation_gain,
        coalesce(sum(
          coalesce(wc.corrected_average_heartrate, w.average_heartrate)
          * coalesce(wc.corrected_moving_time_seconds, w.moving_time_seconds)
        ) filter (where coalesce(wc.corrected_average_heartrate, w.average_heartrate) is not null), 0) as weighted_heartrate_sum,
        coalesce(sum(
          coalesce(wc.corrected_moving_time_seconds, w.moving_time_seconds)
        ) filter (where coalesce(wc.corrected_average_heartrate, w.average_heartrate) is not null), 0) as heartrate_time_seconds
      from workouts w
      join users athlete on athlete.id = w.user_id
      left join workout_corrections wc on wc.workout_id = w.id
      where athlete.id = $1
        and athlete.coach_id = $2
        and w.start_date >= $3
        and w.start_date < $4
      group by athlete.full_name
    `,
    [athleteUserId, coachUserId, weekStart.toISOString(), weekEnd.toISOString()]
  );

  const summary = summaryResult.rows[0];
  if (!summary || Number(summary.workout_count ?? 0) <= 0) {
    return null;
  }

  const streamRowsResult = await pool.query<{
    moving_time_seconds: number | string | null;
    average_heartrate: number | string | null;
    corrected_streams: {
      time?: unknown;
      heartrate?: unknown;
    } | null;
    time_stream: number[] | null;
    heartrate_stream: number[] | null;
  }>(
    `
      select
        coalesce(wc.corrected_moving_time_seconds, w.moving_time_seconds) as moving_time_seconds,
        coalesce(wc.corrected_average_heartrate, w.average_heartrate) as average_heartrate,
        wc.corrected_streams,
        ws.time_stream,
        ws.heartrate_stream
      from workouts w
      left join workout_corrections wc on wc.workout_id = w.id
      left join workout_streams ws on ws.workout_id = w.id
      where w.user_id = $1
        and w.start_date >= $2
        and w.start_date < $3
      order by w.start_date asc
    `,
    [athleteUserId, weekStart.toISOString(), weekEnd.toISOString()]
  );

  const zoneSeconds = [0, 0, 0, 0];

  for (const row of streamRowsResult.rows) {
    const correctedTime = Array.isArray(row.corrected_streams?.time)
      ? row.corrected_streams.time.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      : null;
    const correctedHeartrate = Array.isArray(row.corrected_streams?.heartrate)
      ? row.corrected_streams.heartrate.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      : null;
    const timeStream = correctedTime ?? (Array.isArray(row.time_stream) ? row.time_stream : []);
    const heartrateStream = correctedHeartrate ?? (Array.isArray(row.heartrate_stream) ? row.heartrate_stream : []);

    if (timeStream.length >= 2 && heartrateStream.length >= 2) {
      const size = Math.min(timeStream.length, heartrateStream.length);
      for (let index = 1; index < size; index += 1) {
        const dt = timeStream[index]! - timeStream[index - 1]!;
        if (!Number.isFinite(dt) || dt <= 0) {
          continue;
        }

        const zoneIndex = getHeartRateZoneIndex(heartrateStream[index]!);
        if (zoneIndex >= 0) {
          zoneSeconds[zoneIndex] += dt;
        }
      }
      continue;
    }

    const zoneIndex = getHeartRateZoneIndex(Number(row.average_heartrate ?? NaN));
    const fallbackSeconds = Number(row.moving_time_seconds ?? 0);
    if (zoneIndex >= 0 && Number.isFinite(fallbackSeconds) && fallbackSeconds > 0) {
      zoneSeconds[zoneIndex] += fallbackSeconds;
    }
  }

  const totalDistanceMeters = Number(summary.total_distance_meters ?? 0);
  const totalMovingTimeSeconds = Number(summary.total_moving_time_seconds ?? 0);
  const totalElevationGain = Number(summary.total_elevation_gain ?? 0);
  const heartrateTimeSeconds = Number(summary.heartrate_time_seconds ?? 0);
  const weightedHeartrateSum = Number(summary.weighted_heartrate_sum ?? 0);

  return {
    athleteName: summary.athlete_name,
    workoutCount: Number(summary.workout_count ?? 0),
    totalDistanceMeters,
    totalMovingTimeSeconds,
    totalElevationGain,
    averageSpeed:
      totalMovingTimeSeconds > 0 ? totalDistanceMeters / totalMovingTimeSeconds : null,
    averageHeartrate:
      heartrateTimeSeconds > 0 ? weightedHeartrateSum / heartrateTimeSeconds : null,
    zonePercentages: computeZonePercentages(zoneSeconds)
  };
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
      let message: string;
      if (job.kind === "weekly_report") {
        if (!job.athlete_user_id || !job.report_week_start) {
          throw new Error("TELEGRAM_WEEKLY_REPORT_CONTEXT_MISSING");
        }

        const report = await buildWeeklyReportData(
          job.coach_user_id,
          job.athlete_user_id,
          job.report_week_start
        );
        if (!report) {
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
          continue;
        }

        message = formatTelegramWeeklyReportMessage({
          athleteName: report.athleteName,
          weekStart: job.report_week_start,
          totalDistanceMeters: report.totalDistanceMeters,
          totalMovingTimeSeconds: report.totalMovingTimeSeconds,
          totalElevationGain: report.totalElevationGain,
          averageSpeed: report.averageSpeed,
          averageHeartrate: report.averageHeartrate,
          workoutCount: report.workoutCount,
          zonePercentages: report.zonePercentages
        });
      } else {
        if (!job.workout_id) {
          throw new Error("TELEGRAM_WORKOUT_CONTEXT_MISSING");
        }

        message = formatTelegramWorkoutMessage({
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
      }

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

export async function sendWeeklyTelegramTestMessages(trainerId: number, weekDate: string | Date) {
  if (!isTelegramConfigured()) {
    throw new Error("TELEGRAM_NOT_CONFIGURED");
  }

  const preview = await getWeeklyTelegramPreview(trainerId, weekDate);

  const { rows } = await pool.query<{ telegram_chat_id: string | null }>(
    `select telegram_chat_id from users where id = $1 and role = 'trainer'`,
    [trainerId]
  );
  const chatId = rows[0]?.telegram_chat_id?.trim() ?? "";

  if (!chatId) {
    throw new Error("TELEGRAM_CHAT_ID_EMPTY");
  }

  let sent = 0;

  for (const report of preview.reports) {
    await sendTelegramMessage(
      chatId,
      formatTelegramWeeklyReportMessage({
        athleteName: report.athleteName,
        weekStart: preview.reportWeekStart,
        totalDistanceMeters: report.totalDistanceMeters,
        totalMovingTimeSeconds: report.totalMovingTimeSeconds,
        totalElevationGain: report.totalElevationGain,
        averageSpeed: report.averageSpeed,
        averageHeartrate: report.averageHeartrate,
        workoutCount: report.workoutCount,
        zonePercentages: report.zonePercentages
      })
    );
    sent += 1;
  }

  return {
    trainerName: preview.trainerName,
    reportWeekStart: preview.reportWeekStart,
    sent,
    skipped: preview.skipped
  };
}
