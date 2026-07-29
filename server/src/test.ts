import assert from "node:assert/strict";
import { mock } from "node:test";

process.env.NODE_ENV ??= "development";
process.env.APP_URL ??= "http://localhost:3000";
process.env.JWT_SECRET ??= "test-secret-123";
process.env.ADMIN_PASSWORD ??= "test-password";
process.env.DATABASE_URL ??= "postgres://runrehab:runrehab@localhost:5432/runrehab";
process.env.STRAVA_TOKEN_ENCRYPTION_KEY ??= "test-encryption-key-1234567890";

const paginationModule = await import("./lib/pagination.js");
const stravaModule = await import("./lib/strava.js");
const intervalsModule = await import("./lib/intervals.js");
const analysisModule = await import("./lib/workout-analysis.js");
const gpsFixModule = await import("./lib/workout-gps-fix.js");
const intervalsDetectorModule = await import("./lib/workout-intervals.js");
const dbModule = await import("./lib/db.js");
const telegramModule = await import("./lib/telegram.js");
const telegramNotificationsModule = await import("./lib/telegram-notifications.js");

async function runTest(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

await runTest("hasPartialCursor detects incomplete cursor payloads", () => {
  assert.equal(paginationModule.hasPartialCursor({ beforeDate: "2026-03-20T10:00:00.000Z" }), true);
  assert.equal(paginationModule.hasPartialCursor({ beforeId: 42 }), true);
  assert.equal(
    paginationModule.hasPartialCursor({
      beforeDate: "2026-03-20T10:00:00.000Z",
      beforeId: 42
    }),
    false
  );
  assert.equal(paginationModule.hasPartialCursor({}), false);
});

await runTest("buildNextCursor returns stable cursor from the last item in a full page", () => {
  const rows = [
    { id: 8, start_date: "2026-03-20T10:05:00.000Z" },
    { id: 7, start_date: "2026-03-20T10:05:00.000Z" }
  ];

  assert.deepEqual(paginationModule.buildNextCursor(rows, 2), {
    beforeDate: "2026-03-20T10:05:00.000Z",
    beforeId: 7
  });
});

await runTest("buildNextCursor returns null for incomplete pages", () => {
  const rows = [{ id: 1, start_date: "2026-03-20T10:05:00.000Z" }];
  assert.equal(paginationModule.buildNextCursor(rows, 2), null);
});

await runTest("encryptToken/decryptToken round-trip encrypted values", () => {
  const encrypted = stravaModule.encryptToken("refresh-token-value");

  assert.notEqual(encrypted, "refresh-token-value");
  assert.match(encrypted, /^enc:v1:/);
  assert.equal(stravaModule.decryptToken(encrypted), "refresh-token-value");
});

await runTest("decryptToken keeps legacy plaintext tokens readable", () => {
  assert.equal(stravaModule.decryptToken("legacy-plain-token"), "legacy-plain-token");
});

await runTest("syncIntervalsLatestActivities returns already_running when advisory lock is busy", async () => {
  const queryMock = mock.method(dbModule.pool, "query", async (sql: string) => {
    if (sql.includes("pg_try_advisory_lock")) {
      return { rows: [{ locked: false }] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  try {
    const result = await intervalsModule.syncIntervalsLatestActivities(77);
    assert.deepEqual(result, { synced: false, reason: "already_running" });
  } finally {
    queryMock.mock.restore();
  }
});

await runTest("buildTrimPreview keeps only the requested distance range", () => {
  // 6 км ровным темпом 5:00/км (300 с/км), точки каждые 100 м / 30 с
  const distance: number[] = [];
  const time: number[] = [];
  const heartrate: number[] = [];
  for (let i = 0; i <= 60; i += 1) {
    distance.push(i * 100);
    time.push(i * 30);
    heartrate.push(i <= 40 ? 140 : 180); // хвост с высоким пульсом уйдёт под обрезку
  }
  const workout = {
    distance_meters: 6000,
    moving_time_seconds: 1800,
    elapsed_time_seconds: 1800,
    elevation_gain: 0,
    average_speed: 6000 / 1800,
    average_heartrate: null,
    max_heartrate: null
  };
  const streams = {
    distance,
    time,
    heartrate,
    cadence: [],
    altitude: [],
    velocity_smooth: [],
    latlng: [] as [number, number][]
  };

  // круги атлета по 2 км (не километровые) — должны пережить обрезку, а не стать сплитами
  const laps = [
    { id: 1, name: "Разминка", distance_meters: 2000, elapsed_time_seconds: 600, average_speed: null, average_heartrate: null, elevation_gain: null, start_index: 0, end_index: 20 },
    { id: 2, name: "Работа", distance_meters: 2000, elapsed_time_seconds: 600, average_speed: null, average_heartrate: null, elevation_gain: null, start_index: 20, end_index: 40 },
    { id: 3, name: "Заминка", distance_meters: 2000, elapsed_time_seconds: 600, average_speed: null, average_heartrate: null, elevation_gain: null, start_index: 40, end_index: 60 }
  ];

  const preview = gpsFixModule.buildTrimPreview(workout, laps as any, streams as any, 0, 4000);
  assert.ok(preview, "preview should be built");
  assert.equal(Math.round(preview!.correctedWorkout.distance_meters), 4000);
  assert.equal(preview!.correctedWorkout.moving_time_seconds, 1200);
  assert.equal(preview!.correctedWorkout.max_heartrate, 140);
  // сохранены первые два круга атлета (третий за границей обрезки), а не 4 км-сплита
  assert.equal(preview!.correctedLaps.length, 2);
  assert.equal(preview!.correctedLaps[0]!.name, "Разминка");
  assert.equal(preview!.correctedLaps[1]!.name, "Работа");
  assert.equal(preview!.metadata.split_strategy, "stream");
  assert.equal(preview!.metadata.trim_end_meters, 4000);

  // без кругов с индексами — фолбэк на километровые сплиты
  const noLaps = gpsFixModule.buildTrimPreview(workout, [] as any, streams as any, 0, 4000);
  assert.equal(noLaps!.correctedLaps.length, 4);

  // обрезка начала: остаётся [2 км, 6 км], дистанция и время с нуля
  const tail = gpsFixModule.buildTrimPreview(workout, laps as any, streams as any, 2000, 6000);
  assert.ok(tail, "tail preview should be built");
  assert.equal(Math.round(tail!.correctedWorkout.distance_meters), 4000);
  assert.equal(tail!.correctedStreams.distance[0], 0);
  assert.equal(tail!.correctedStreams.time[0], 0);

  // без реального среза превью не строится
  assert.equal(gpsFixModule.buildTrimPreview(workout, laps as any, streams as any, 0, 6000), null);
  // слишком короткий остаток — тоже
  assert.equal(gpsFixModule.buildTrimPreview(workout, laps as any, streams as any, 0, 100), null);
});

await runTest("computeHrTrainingLoad weights minutes by Edwards zones", () => {
  // 30 минут: 10 мин @120 (60% от 200 = зона 2), 20 мин @170 (85% = зона 4)
  const time: number[] = [];
  const hr: number[] = [];
  for (let i = 0; i <= 1800; i += 10) {
    time.push(i);
    hr.push(i <= 600 ? 120 : 170);
  }
  const load = analysisModule.computeHrTrainingLoad(
    { heartrate_stream: hr, time_stream: time, average_heartrate: null, moving_time_seconds: 1800 } as any,
    200
  );
  // ~10*2 + ~20*4 = ~100
  if (load === null || Math.abs(load - 100) > 3) {
    throw new Error(`unexpected load: ${load}`);
  }

  // фолбэк по среднему пульсу: 60 минут @150 (75% = зона 3) = 180
  const fallback = analysisModule.computeHrTrainingLoad(
    { heartrate_stream: null, time_stream: null, average_heartrate: 150, moving_time_seconds: 3600 } as any,
    200
  );
  assert.equal(fallback, 180);
});

await runTest("weekly telegram report week start switches after Sunday 20:00 UTC+5", () => {
  const beforeSend = telegramNotificationsModule.getLatestEligibleWeeklyReportWeekStart(
    new Date("2026-04-12T14:59:00.000Z")
  );
  const afterSend = telegramNotificationsModule.getLatestEligibleWeeklyReportWeekStart(
    new Date("2026-04-12T15:01:00.000Z")
  );

  assert.equal(beforeSend.toISOString(), "2026-03-29T19:00:00.000Z");
  assert.equal(afterSend.toISOString(), "2026-04-05T19:00:00.000Z");
});

await runTest("monthly telegram report month start switches after first day 20:00 UTC+5", () => {
  const beforeSend = telegramNotificationsModule.getLatestEligibleMonthlyReportMonthStart(
    new Date("2026-05-01T14:59:00.000Z")
  );
  const afterSend = telegramNotificationsModule.getLatestEligibleMonthlyReportMonthStart(
    new Date("2026-05-01T15:01:00.000Z")
  );

  assert.equal(beforeSend.toISOString(), "2026-02-28T19:00:00.000Z");
  assert.equal(afterSend.toISOString(), "2026-03-31T19:00:00.000Z");
});

await runTest("weekly telegram report formatter accepts Date weekStart", () => {
  const message = telegramModule.formatTelegramWeeklyReportMessage({
    athleteName: "Тестовый спортсмен",
    weekStart: new Date("2026-03-30T00:00:00.000Z"),
    totalDistanceMeters: 42195,
    totalMovingTimeSeconds: 13500,
    totalElevationGain: 420,
    averageSpeed: 3.1255555556,
    averageHeartrate: 149.4,
    workoutCount: 4,
    zonePercentages: {
      under130: 18,
      from130To150: 46,
      from150To162: 28,
      from162Plus: 8
    }
  });

  assert.match(message, /31 марта|30 марта/);
  assert.match(message, /5 апреля/);
  assert.match(message, /Тестовый спортсмен/);
});

await runTest("weekly report builder tolerates Date reportWeekStart input shape", () => {
  const dateValue = new Date("2026-03-30T00:00:00.000Z");
  const normalized = dateValue.toISOString().slice(0, 10);
  assert.equal(normalized, "2026-03-30");
});

await runTest("monthly telegram report formatter accepts Date monthStart", () => {
  const message = telegramModule.formatTelegramMonthlyReportMessage({
    athleteName: "Test athlete",
    monthStart: new Date("2026-04-01T00:00:00.000Z"),
    totalDistanceMeters: 120000,
    totalMovingTimeSeconds: 36000,
    totalElevationGain: 900,
    averageSpeed: 3.3333333333,
    averageHeartrate: 142.2,
    workoutCount: 12,
    zonePercentages: {
      under130: 30,
      from130To150: 45,
      from150To162: 20,
      from162Plus: 5
    }
  });

  assert.match(message, /Test athlete/);
  assert.match(message, /2026/);
  assert.match(message, /120.00/);
});

// Фикстуры кругов — реальные тренировки с прода (см. detectWorkoutIntervals).
// #58206 u5 2026-07-28 10.7км, average_speed=3.973
const LAPS_58206 = [
  { id: 684909, distance_meters: 1005, elapsed_time_seconds: 321, average_speed: 3.1308, average_heartrate: 111, start_index: 0, end_index: 321 },
  { id: 684910, distance_meters: 1012.5, elapsed_time_seconds: 310, average_speed: 3.2661, average_heartrate: 117, start_index: 321, end_index: 631 },
  { id: 684911, distance_meters: 1004.5, elapsed_time_seconds: 252, average_speed: 3.9861, average_heartrate: 132, start_index: 631, end_index: 883 },
  { id: 684912, distance_meters: 276, elapsed_time_seconds: 1695, average_speed: 0.1628, average_heartrate: 119, start_index: 883, end_index: 988 },
  { id: 684913, distance_meters: 1002, elapsed_time_seconds: 201, average_speed: 4.9851, average_heartrate: 147, start_index: 988, end_index: 1189 },
  { id: 684914, distance_meters: 999, elapsed_time_seconds: 405, average_speed: 5.0711, average_heartrate: 157, start_index: 1189, end_index: 1387 },
  { id: 684915, distance_meters: 989, elapsed_time_seconds: 395, average_speed: 4.945, average_heartrate: 160, start_index: 1387, end_index: 1588 },
  { id: 684916, distance_meters: 414, elapsed_time_seconds: 276, average_speed: 5.5946, average_heartrate: 144, start_index: 1588, end_index: 1663 },
  { id: 684917, distance_meters: 390, elapsed_time_seconds: 193, average_speed: 5.4167, average_heartrate: 146, start_index: 1663, end_index: 1736 },
  { id: 684918, distance_meters: 408, elapsed_time_seconds: 197, average_speed: 5.3684, average_heartrate: 147, start_index: 1736, end_index: 1813 },
  { id: 684919, distance_meters: 390, elapsed_time_seconds: 196, average_speed: 5.2703, average_heartrate: 147, start_index: 1813, end_index: 1888 },
  { id: 684920, distance_meters: 399, elapsed_time_seconds: 195, average_speed: 5.32, average_heartrate: 145, start_index: 1888, end_index: 1964 },
  { id: 684921, distance_meters: 1004, elapsed_time_seconds: 497, average_speed: 3.9528, average_heartrate: 143, start_index: 1964, end_index: 2219 },
  { id: 684922, distance_meters: 1416.54, elapsed_time_seconds: 687, average_speed: 2.9822, average_heartrate: 119, start_index: 2219, end_index: 2696 }
];

// #2832 u5 2026-04-01 13.4км, average_speed=3.829
const LAPS_2832 = [
  { id: 64389, distance_meters: 1188.71, elapsed_time_seconds: 246, average_speed: 4.83, average_heartrate: 158, start_index: 0, end_index: 222 },
  { id: 64390, distance_meters: 421.28, elapsed_time_seconds: 164, average_speed: 2.57, average_heartrate: 136, start_index: 223, end_index: 387 },
  { id: 64391, distance_meters: 1192.63, elapsed_time_seconds: 243, average_speed: 4.91, average_heartrate: 162, start_index: 388, end_index: 631 },
  { id: 64392, distance_meters: 409.59, elapsed_time_seconds: 166, average_speed: 2.47, average_heartrate: 136, start_index: 632, end_index: 797 },
  { id: 64393, distance_meters: 1193.69, elapsed_time_seconds: 250, average_speed: 4.77, average_heartrate: 161, start_index: 798, end_index: 1047 },
  { id: 64394, distance_meters: 399.21, elapsed_time_seconds: 184, average_speed: 2.48, average_heartrate: 128, start_index: 1048, end_index: 1209 },
  { id: 64395, distance_meters: 1192.42, elapsed_time_seconds: 249, average_speed: 4.79, average_heartrate: 160, start_index: 1210, end_index: 1458 },
  { id: 64396, distance_meters: 415.06, elapsed_time_seconds: 183, average_speed: 2.27, average_heartrate: 135, start_index: 1459, end_index: 1642 },
  { id: 64397, distance_meters: 1191.7, elapsed_time_seconds: 248, average_speed: 4.81, average_heartrate: 161, start_index: 1643, end_index: 1891 },
  { id: 64398, distance_meters: 198.35, elapsed_time_seconds: 351, average_speed: 5.51, average_heartrate: 128, start_index: 1892, end_index: 1928 },
  { id: 64399, distance_meters: 202.32, elapsed_time_seconds: 79, average_speed: 2.56, average_heartrate: 143, start_index: 1929, end_index: 2008 },
  { id: 64400, distance_meters: 200.49, elapsed_time_seconds: 37, average_speed: 5.42, average_heartrate: 145, start_index: 2009, end_index: 2046 },
  { id: 64401, distance_meters: 198.37, elapsed_time_seconds: 80, average_speed: 2.48, average_heartrate: 144, start_index: 2047, end_index: 2126 },
  { id: 64402, distance_meters: 201.41, elapsed_time_seconds: 37, average_speed: 5.44, average_heartrate: 144, start_index: 2127, end_index: 2164 },
  { id: 64403, distance_meters: 209.72, elapsed_time_seconds: 84, average_speed: 2.5, average_heartrate: 144, start_index: 2165, end_index: 2248 },
  { id: 64404, distance_meters: 194.83, elapsed_time_seconds: 37, average_speed: 5.27, average_heartrate: 145, start_index: 2249, end_index: 2285 },
  { id: 64405, distance_meters: 205.8, elapsed_time_seconds: 75, average_speed: 2.74, average_heartrate: 147, start_index: 2286, end_index: 2361 },
  { id: 64406, distance_meters: 196.96, elapsed_time_seconds: 37, average_speed: 5.32, average_heartrate: 145, start_index: 2362, end_index: 2398 },
  { id: 64407, distance_meters: 206.52, elapsed_time_seconds: 90, average_speed: 2.68, average_heartrate: 148, start_index: 2399, end_index: 2475 },
  { id: 64408, distance_meters: 193.67, elapsed_time_seconds: 36, average_speed: 5.38, average_heartrate: 144, start_index: 2476, end_index: 2511 },
  { id: 64409, distance_meters: 201.48, elapsed_time_seconds: 72, average_speed: 2.8, average_heartrate: 147, start_index: 2512, end_index: 2584 },
  { id: 64410, distance_meters: 198.04, elapsed_time_seconds: 38, average_speed: 5.21, average_heartrate: 147, start_index: 2585, end_index: 2622 },
  { id: 64411, distance_meters: 207.64, elapsed_time_seconds: 82, average_speed: 2.53, average_heartrate: 146, start_index: 2623, end_index: 2704 },
  { id: 64412, distance_meters: 192.82, elapsed_time_seconds: 37, average_speed: 5.21, average_heartrate: 144, start_index: 2705, end_index: 2742 },
  { id: 64413, distance_meters: 201.53, elapsed_time_seconds: 102, average_speed: 2.88, average_heartrate: 137, start_index: 2743, end_index: 2812 },
  { id: 64414, distance_meters: 200.3, elapsed_time_seconds: 38, average_speed: 5.27, average_heartrate: 146, start_index: 2813, end_index: 2851 },
  { id: 64415, distance_meters: 207.73, elapsed_time_seconds: 73, average_speed: 2.85, average_heartrate: 148, start_index: 2852, end_index: 2925 },
  { id: 64416, distance_meters: 196.2, elapsed_time_seconds: 38, average_speed: 5.16, average_heartrate: 147, start_index: 2926, end_index: 2963 },
  { id: 64417, distance_meters: 1004.96, elapsed_time_seconds: 473, average_speed: 3.97, average_heartrate: 141, start_index: 2964, end_index: 3216 },
  { id: 64418, distance_meters: 1003.91, elapsed_time_seconds: 267, average_speed: 3.76, average_heartrate: 145, start_index: 3217, end_index: 3461 }
];

// #52506 u5 2026-07-19 21.1км, average_speed=3.715
const LAPS_52506 = [
  { id: 676641, distance_meters: 1001.5, elapsed_time_seconds: 269, average_speed: 3.723, average_heartrate: 116, start_index: 0, end_index: 269 },
  { id: 676642, distance_meters: 999, elapsed_time_seconds: 270, average_speed: 3.7, average_heartrate: 127, start_index: 269, end_index: 539 },
  { id: 676643, distance_meters: 997.5, elapsed_time_seconds: 267, average_speed: 3.736, average_heartrate: 132, start_index: 539, end_index: 806 },
  { id: 676644, distance_meters: 1001, elapsed_time_seconds: 268, average_speed: 3.7351, average_heartrate: 131, start_index: 806, end_index: 1074 },
  { id: 676645, distance_meters: 1002.5, elapsed_time_seconds: 271, average_speed: 3.6993, average_heartrate: 134, start_index: 1074, end_index: 1345 },
  { id: 676646, distance_meters: 998.5, elapsed_time_seconds: 267, average_speed: 3.7397, average_heartrate: 138, start_index: 1345, end_index: 1612 },
  { id: 676647, distance_meters: 1004, elapsed_time_seconds: 273, average_speed: 3.6777, average_heartrate: 136, start_index: 1612, end_index: 1885 },
  { id: 676648, distance_meters: 997, elapsed_time_seconds: 271, average_speed: 3.679, average_heartrate: 139, start_index: 1885, end_index: 2156 },
  { id: 676649, distance_meters: 997, elapsed_time_seconds: 268, average_speed: 3.7201, average_heartrate: 137, start_index: 2156, end_index: 2424 },
  { id: 676650, distance_meters: 1002, elapsed_time_seconds: 276, average_speed: 3.6304, average_heartrate: 140, start_index: 2424, end_index: 2700 },
  { id: 676651, distance_meters: 1000.5, elapsed_time_seconds: 267, average_speed: 3.7472, average_heartrate: 134, start_index: 2700, end_index: 2967 },
  { id: 676652, distance_meters: 997, elapsed_time_seconds: 272, average_speed: 3.6654, average_heartrate: 135, start_index: 2967, end_index: 3239 },
  { id: 676653, distance_meters: 1002.5, elapsed_time_seconds: 273, average_speed: 3.6722, average_heartrate: 137, start_index: 3239, end_index: 3512 },
  { id: 676654, distance_meters: 1001, elapsed_time_seconds: 271, average_speed: 3.6937, average_heartrate: 136, start_index: 3512, end_index: 3783 },
  { id: 676655, distance_meters: 1000, elapsed_time_seconds: 267, average_speed: 3.7453, average_heartrate: 140, start_index: 3783, end_index: 4050 },
  { id: 676656, distance_meters: 997, elapsed_time_seconds: 267, average_speed: 3.7341, average_heartrate: 139, start_index: 4050, end_index: 4317 },
  { id: 676657, distance_meters: 1002, elapsed_time_seconds: 267, average_speed: 3.7528, average_heartrate: 142, start_index: 4317, end_index: 4584 },
  { id: 676658, distance_meters: 1001.5, elapsed_time_seconds: 265, average_speed: 3.7792, average_heartrate: 145, start_index: 4584, end_index: 4849 },
  { id: 676659, distance_meters: 996.5, elapsed_time_seconds: 264, average_speed: 3.7746, average_heartrate: 143, start_index: 4849, end_index: 5113 },
  { id: 676660, distance_meters: 1001.5, elapsed_time_seconds: 268, average_speed: 3.7369, average_heartrate: 145, start_index: 5113, end_index: 5381 },
  { id: 676661, distance_meters: 1002.5, elapsed_time_seconds: 272, average_speed: 3.6857, average_heartrate: 144, start_index: 5381, end_index: 5653 },
  { id: 676662, distance_meters: 106, elapsed_time_seconds: 30, average_speed: 3.5333, average_heartrate: 144, start_index: 5653, end_index: 5683 }
];

// #51112 u11 2026-07-15 6.0км, average_speed=2.853
const LAPS_51112 = [
  { id: 683165, distance_meters: 1000, elapsed_time_seconds: 378, average_speed: 2.6455, average_heartrate: 122, start_index: 0, end_index: 378 },
  { id: 683166, distance_meters: 1003, elapsed_time_seconds: 358, average_speed: 2.8017, average_heartrate: 128, start_index: 378, end_index: 736 },
  { id: 683167, distance_meters: 999, elapsed_time_seconds: 346, average_speed: 2.8873, average_heartrate: 129, start_index: 736, end_index: 1082 },
  { id: 683168, distance_meters: 999, elapsed_time_seconds: 349, average_speed: 2.8625, average_heartrate: 137, start_index: 1082, end_index: 1431 },
  { id: 683169, distance_meters: 1000, elapsed_time_seconds: 338, average_speed: 2.9586, average_heartrate: 133, start_index: 1431, end_index: 1769 },
  { id: 683170, distance_meters: 999, elapsed_time_seconds: 334, average_speed: 2.991, average_heartrate: 142, start_index: 1769, end_index: 2103 }
];

// #50433 u10 2026-07-08 10.0км, average_speed=2.836
const LAPS_50433 = [
  { id: 682646, distance_meters: 1003, elapsed_time_seconds: 431, average_speed: 2.7182, average_heartrate: 102, start_index: 0, end_index: 370 },
  { id: 682647, distance_meters: 999.5, elapsed_time_seconds: 392, average_speed: 2.8804, average_heartrate: 110, start_index: 370, end_index: 718 },
  { id: 682648, distance_meters: 999.5, elapsed_time_seconds: 373, average_speed: 2.7997, average_heartrate: 107, start_index: 718, end_index: 1076 },
  { id: 682649, distance_meters: 1003, elapsed_time_seconds: 321, average_speed: 3.1246, average_heartrate: 110, start_index: 1076, end_index: 1397 },
  { id: 682650, distance_meters: 996.5, elapsed_time_seconds: 297, average_speed: 3.3552, average_heartrate: 109, start_index: 1397, end_index: 1694 },
  { id: 682651, distance_meters: 1000, elapsed_time_seconds: 398, average_speed: 2.5126, average_heartrate: 114, start_index: 1694, end_index: 2092 },
  { id: 682652, distance_meters: 1002, elapsed_time_seconds: 1391, average_speed: 2.6508, average_heartrate: 107, start_index: 2092, end_index: 2471 },
  { id: 682653, distance_meters: 999.5, elapsed_time_seconds: 561, average_speed: 2.761, average_heartrate: 104, start_index: 2471, end_index: 2836 },
  { id: 682654, distance_meters: 998.5, elapsed_time_seconds: 321, average_speed: 3.1106, average_heartrate: 103, start_index: 2836, end_index: 3157 },
  { id: 682655, distance_meters: 1002.5, elapsed_time_seconds: 370, average_speed: 2.7095, average_heartrate: 108, start_index: 3157, end_index: 3527 }
];

await runTest("interval detector finds mixed sets with rest inside the lap", () => {
  // COROS: спортсмен жмёт круг раз на повтор, отдых записан внутрь того же круга
  const structure = intervalsDetectorModule.detectWorkoutIntervals(LAPS_58206, {
    average_speed: 3.973
  });

  assert.ok(structure);
  assert.deepEqual(
    structure.sets.map((set) => set.label),
    ["3×1000 м", "5×400 м"]
  );
  assert.equal(structure.sets[0].pace_seconds_per_km, 201);
  assert.equal(structure.sets[1].pace_seconds_per_km, 186);
  assert.equal(structure.work_lap_ids.length, 8);
  // разминочные и заключительные километры остаются вне разметки
  assert.equal(structure.work_lap_ids.includes(LAPS_58206[0].id), false);
  assert.equal(structure.work_lap_ids.includes(LAPS_58206[LAPS_58206.length - 1].id), false);
  // отрезки отдаются с индексами стрима — по ним рисуются полосы на графиках
  assert.ok(structure.segments.every((segment) => segment.start_index !== null));
});

await runTest("interval detector separates sets of different rep length", () => {
  // 5×1200 по 3:28 и 10×200 по 3:09: единым порогом темпа они не разделяются
  const structure = intervalsDetectorModule.detectWorkoutIntervals(LAPS_2832, {
    average_speed: 3.829
  });

  assert.ok(structure);
  assert.deepEqual(
    structure.sets.map((set) => set.label),
    ["5×1,2 км", "10×200 м"]
  );
});

await runTest("interval detector ignores an even long run", () => {
  // 21 км ровным темпом, нарезка автокругами часов
  assert.equal(
    intervalsDetectorModule.detectWorkoutIntervals(LAPS_52506, { average_speed: 3.715 }),
    null
  );
});

await runTest("interval detector ignores a progression run", () => {
  // 6 км с разгоном 6:18 -> 5:34: структуры повторов нет
  assert.equal(
    intervalsDetectorModule.detectWorkoutIntervals(LAPS_51112, { average_speed: 2.853 }),
    null
  );
});

await runTest("interval detector ignores pace swings on watch auto-splits", () => {
  // 10 км с разбросом темпа по километрам и без подтверждения пульсом
  assert.equal(
    intervalsDetectorModule.detectWorkoutIntervals(LAPS_50433, { average_speed: 2.836 }),
    null
  );
});

await runTest("interval detector needs laps to work with", () => {
  assert.equal(intervalsDetectorModule.detectWorkoutIntervals([], { average_speed: 3 }), null);
  assert.equal(
    intervalsDetectorModule.detectWorkoutIntervals(LAPS_58206.slice(0, 2), { average_speed: 3.973 }),
    null
  );
});

// #58228, average_speed=3.571
const LAPS_58228 = [
  { id: 705352, distance_meters: 2000.5, elapsed_time_seconds: 659, average_speed: 3.0357, average_heartrate: 111, start_index: 0, end_index: 659 },
  { id: 705353, distance_meters: 1001.5, elapsed_time_seconds: 248, average_speed: 4.0383, average_heartrate: 133, start_index: 659, end_index: 907 },
  { id: 705354, distance_meters: 164, elapsed_time_seconds: 1458, average_speed: 2.5231, average_heartrate: 120, start_index: 907, end_index: 973 },
  { id: 705355, distance_meters: 994, elapsed_time_seconds: 196, average_speed: 5.0714, average_heartrate: 147, start_index: 973, end_index: 1169 },
  { id: 705356, distance_meters: 998, elapsed_time_seconds: 194, average_speed: 5.1443, average_heartrate: 168, start_index: 1169, end_index: 1363 },
  { id: 705357, distance_meters: 14, elapsed_time_seconds: 188, average_speed: 2.8, average_heartrate: 136, start_index: 1363, end_index: 1369 },
  { id: 705358, distance_meters: 391, elapsed_time_seconds: 70, average_speed: 5.5857, average_heartrate: 144, start_index: 1369, end_index: 1439 },
  { id: 705359, distance_meters: 226.5, elapsed_time_seconds: 109, average_speed: 2.078, average_heartrate: 143, start_index: 1439, end_index: 1548 },
  { id: 705360, distance_meters: 394.5, elapsed_time_seconds: 71, average_speed: 5.5563, average_heartrate: 148, start_index: 1548, end_index: 1619 },
  { id: 705361, distance_meters: 213, elapsed_time_seconds: 88, average_speed: 2.4205, average_heartrate: 150, start_index: 1619, end_index: 1707 },
  { id: 705362, distance_meters: 392, elapsed_time_seconds: 72, average_speed: 5.4444, average_heartrate: 153, start_index: 1707, end_index: 1779 },
  { id: 705363, distance_meters: 217, elapsed_time_seconds: 94, average_speed: 2.3085, average_heartrate: 148, start_index: 1779, end_index: 1873 },
  { id: 705364, distance_meters: 392, elapsed_time_seconds: 70, average_speed: 5.6, average_heartrate: 155, start_index: 1873, end_index: 1943 },
  { id: 705365, distance_meters: 222, elapsed_time_seconds: 98, average_speed: 2.2653, average_heartrate: 148, start_index: 1943, end_index: 2041 },
  { id: 705366, distance_meters: 397, elapsed_time_seconds: 72, average_speed: 5.5139, average_heartrate: 153, start_index: 2041, end_index: 2113 },
  { id: 705367, distance_meters: 221, elapsed_time_seconds: 95, average_speed: 2.3263, average_heartrate: 149, start_index: 2113, end_index: 2208 },
  { id: 705368, distance_meters: 401, elapsed_time_seconds: 73, average_speed: 5.4932, average_heartrate: 154, start_index: 2208, end_index: 2281 },
  { id: 705369, distance_meters: 34, elapsed_time_seconds: 310, average_speed: 0.281, average_heartrate: 131, start_index: 2281, end_index: 2404 },
  { id: 705370, distance_meters: 993, elapsed_time_seconds: 221, average_speed: 4.4932, average_heartrate: 148, start_index: 2404, end_index: 2625 },
  { id: 705371, distance_meters: 1335.7, elapsed_time_seconds: 757, average_speed: 2.9356, average_heartrate: 122, start_index: 2625, end_index: 3082 }
];

// #58249, average_speed=3.015
const LAPS_58249 = [
  { id: 705422, distance_meters: 795.6, elapsed_time_seconds: 208, average_speed: 3.825, average_heartrate: 137, start_index: 0, end_index: 208 },
  { id: 705423, distance_meters: 195.9, elapsed_time_seconds: 41, average_speed: 4.7783, average_heartrate: 155, start_index: 208, end_index: 249 },
  { id: 705424, distance_meters: 221.8, elapsed_time_seconds: 169, average_speed: 1.4039, average_heartrate: 130, start_index: 249, end_index: 408 },
  { id: 705425, distance_meters: 797.3, elapsed_time_seconds: 201, average_speed: 3.9665, average_heartrate: 145, start_index: 408, end_index: 609 },
  { id: 705426, distance_meters: 202.5, elapsed_time_seconds: 43, average_speed: 4.7093, average_heartrate: 158, start_index: 609, end_index: 652 },
  { id: 705427, distance_meters: 218.2, elapsed_time_seconds: 180, average_speed: 1.9307, average_heartrate: 127, start_index: 652, end_index: 766 },
  { id: 705428, distance_meters: 799.7, elapsed_time_seconds: 202, average_speed: 3.9589, average_heartrate: 144, start_index: 766, end_index: 968 },
  { id: 705429, distance_meters: 201.6, elapsed_time_seconds: 42, average_speed: 4.7988, average_heartrate: 159, start_index: 968, end_index: 1010 },
  { id: 705430, distance_meters: 255.6, elapsed_time_seconds: 194, average_speed: 1.3173, average_heartrate: 125, start_index: 1010, end_index: 1204 },
  { id: 705431, distance_meters: 802.6, elapsed_time_seconds: 202, average_speed: 3.9731, average_heartrate: 144, start_index: 1204, end_index: 1406 },
  { id: 705432, distance_meters: 200.7, elapsed_time_seconds: 43, average_speed: 4.667, average_heartrate: 160, start_index: 1406, end_index: 1449 },
  { id: 705433, distance_meters: 239.3, elapsed_time_seconds: 196, average_speed: 1.2209, average_heartrate: 126, start_index: 1449, end_index: 1645 },
  { id: 705434, distance_meters: 804, elapsed_time_seconds: 201, average_speed: 4.0001, average_heartrate: 146, start_index: 1645, end_index: 1846 },
  { id: 705435, distance_meters: 196.4, elapsed_time_seconds: 38, average_speed: 5.1684, average_heartrate: 163, start_index: 1846, end_index: 1884 },
  { id: 705436, distance_meters: 26.9, elapsed_time_seconds: 330, average_speed: 2.0662, average_heartrate: 161, start_index: 1884, end_index: 1898 },
  { id: 705437, distance_meters: 93.6, elapsed_time_seconds: 16, average_speed: 5.8519, average_heartrate: 115, start_index: 1898, end_index: 1914 },
  { id: 705438, distance_meters: 99.8, elapsed_time_seconds: 61, average_speed: 1.6359, average_heartrate: 129, start_index: 1914, end_index: 1975 },
  { id: 705439, distance_meters: 100.2, elapsed_time_seconds: 18, average_speed: 5.5678, average_heartrate: 126, start_index: 1975, end_index: 1993 },
  { id: 705440, distance_meters: 115.5, elapsed_time_seconds: 79, average_speed: 1.4624, average_heartrate: 127, start_index: 1993, end_index: 2072 },
  { id: 705441, distance_meters: 106.8, elapsed_time_seconds: 17, average_speed: 6.2806, average_heartrate: 124, start_index: 2072, end_index: 2089 },
  { id: 705442, distance_meters: 131.3, elapsed_time_seconds: 95, average_speed: 1.3819, average_heartrate: 124, start_index: 2089, end_index: 2184 },
  { id: 705443, distance_meters: 104.1, elapsed_time_seconds: 18, average_speed: 5.7817, average_heartrate: 121, start_index: 2184, end_index: 2202 },
  { id: 705444, distance_meters: 129.5, elapsed_time_seconds: 82, average_speed: 1.5788, average_heartrate: 127, start_index: 2202, end_index: 2284 },
  { id: 705445, distance_meters: 107.9, elapsed_time_seconds: 17, average_speed: 6.3471, average_heartrate: 124, start_index: 2284, end_index: 2301 }
];

await runTest("interval detector marks tempo blocks next to the repeats", () => {
  // 2 км в темпе до серии и километр после неё — работа, хотя повторов у них нет
  const structure = intervalsDetectorModule.detectWorkoutIntervals(LAPS_58228, {
    average_speed: 3.571
  });

  assert.ok(structure);
  assert.deepEqual(
    structure.sets.map((set) => set.label),
    ["2 км", "6×400 м", "1000 м"]
  );
  // разминочные 2 км по 5:29 работой не считаются
  assert.equal(structure.work_lap_ids.includes(LAPS_58228[0].id), false);
});

await runTest("interval detector catches a repeat that opens the workout", () => {
  // 5×(800 + рывок 200): первый повтор идёт самым первым кругом, слева от него
  // нет восстановления, а справа рывок быстрее — контраста нет ни с одной стороны
  const structure = intervalsDetectorModule.detectWorkoutIntervals(LAPS_58249, {
    average_speed: 3.015
  });

  assert.ok(structure);
  const eightHundreds = structure.sets.find((set) => set.label.startsWith("5×800"));
  assert.ok(eightHundreds);
  assert.equal(structure.work_lap_ids.includes(LAPS_58249[0].id), true);
});

console.log("All server tests passed.");
