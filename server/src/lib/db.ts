import pg from "pg";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import { config } from "../config.js";
import { hashPassword } from "./auth.js";

const require = createRequire(import.meta.url);
const { runner: runMigrations } = require("node-pg-migrate");

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.DATABASE_URL
});

export async function ensureSchema() {
  const client = await pool.connect();
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  
  try {
    // В dev-режиме (ts-node/tsx) путь к migrations будет
    // "../../../migrations" относительно src/lib/db.ts
    // В prod-режиме (после tsc в dist/lib/db.js) путь тоже "../../../migrations" 
    // если они не скопированы, но обычно они лежат в корне.
    // Проще найти корень через require
    const dir = path.resolve(__dirname, "../../migrations");
    
    await runMigrations({
      dbClient: client,
      dir,
      direction: "up",
      migrationsTable: "pgmigrations",
      log: (msg: string) => console.log(`[migrate] ${msg}`)
    });
  } catch (err) {
    console.error("Failed to run migrations", err);
    throw err;
  } finally {
    client.release();
  }

  const adminCount = await pool.query(
    `select count(*)::int as count from users where role = 'admin'`
  );

  if (adminCount.rows[0].count === 0) {
    const passwordHash = await hashPassword(config.ADMIN_PASSWORD);
    await pool.query(
      `
        insert into users (username, password_hash, full_name, role)
        values ($1, $2, $3, 'admin')
      `,
      [config.ADMIN_USERNAME, passwordHash, config.ADMIN_FULL_NAME]
    );
  }
}
