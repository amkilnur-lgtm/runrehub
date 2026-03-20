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
const dbModule = await import("./lib/db.js");

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

await runTest("createWebhookFingerprint is deterministic for identical payloads", () => {
  const payload = {
    owner_id: 101,
    object_id: 202,
    aspect_type: "create",
    object_type: "activity",
    event_time: 1711111111,
    subscription_id: 303
  };

  assert.equal(
    stravaModule.createWebhookFingerprint(payload),
    stravaModule.createWebhookFingerprint(payload)
  );
});

await runTest("syncLatestActivities returns already_running when advisory lock is busy", async () => {
  const queryMock = mock.method(dbModule.pool, "query", async (sql: string) => {
    if (sql.includes("pg_try_advisory_lock")) {
      return { rows: [{ locked: false }] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  try {
    const result = await stravaModule.syncLatestActivities(77);
    assert.deepEqual(result, { synced: false, reason: "already_running" });
  } finally {
    queryMock.mock.restore();
  }
});

console.log("All server tests passed.");
