import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { FastifyInstance } from "fastify";

import { pool } from "./db.js";

// Файлы анализов: server/uploads/labs (тот же docker volume, что и аватары, но НЕ под статикой —
// статика отдаёт только uploads/avatars). Открываются по подписанной ссылке на 10 минут.
export const LAB_MIME = new Map([
  ["application/pdf", "pdf"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/heic", "heic"],
  ["image/heif", "heif"]
]);
export const MAX_LAB_BYTES = 10 * 1024 * 1024;
const labsDir = path.join(process.cwd(), "server", "uploads", "labs");

function day(value: unknown) {
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  return String(value).slice(0, 10);
}

export async function listLabFiles(userId: number) {
  const { rows } = await pool.query(
    `select id, taken_on, title, mime, size_bytes, original_name from lab_files where user_id = $1 order by taken_on desc, id desc`,
    [userId]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    taken_on: day(row.taken_on),
    title: row.title ?? null,
    mime: String(row.mime),
    size_bytes: Number(row.size_bytes),
    original_name: row.original_name ?? null
  }));
}

export async function saveLabFile(userId: number, input: { buffer: Buffer; mime: string; takenOn: string; title: string | null; originalName: string | null }) {
  const ext = LAB_MIME.get(input.mime);
  if (!ext) throw Object.assign(new Error("Можно фото или PDF"), { statusCode: 400 });
  if (!input.buffer.length) throw Object.assign(new Error("Файл пустой"), { statusCode: 400 });
  if (input.buffer.length > MAX_LAB_BYTES) throw Object.assign(new Error("Файл больше 10 МБ"), { statusCode: 400 });
  await fs.mkdir(labsDir, { recursive: true });
  const storedName = `u${userId}-${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${ext}`;
  await fs.writeFile(path.join(labsDir, storedName), input.buffer);
  await pool.query(
    `insert into lab_files (user_id, taken_on, title, mime, size_bytes, stored_name, original_name) values ($1, $2, $3, $4, $5, $6, $7)`,
    [userId, input.takenOn, input.title, input.mime, input.buffer.length, storedName, input.originalName]
  );
}

export async function deleteLabFile(userId: number, fileId: number) {
  const { rows } = await pool.query(`delete from lab_files where id = $1 and user_id = $2 returning stored_name`, [fileId, userId]);
  if (rows[0]) await fs.rm(path.join(labsDir, path.basename(String(rows[0].stored_name))), { force: true });
}

export async function readLabFile(fileId: number) {
  const { rows } = await pool.query(`select user_id, mime, stored_name, original_name, taken_on from lab_files where id = $1`, [fileId]);
  const row = rows[0];
  if (!row) return null;
  const buffer = await fs.readFile(path.join(labsDir, path.basename(String(row.stored_name)))).catch(() => null);
  if (!buffer) return null;
  return { userId: Number(row.user_id), mime: String(row.mime), buffer, name: String(row.original_name ?? `analysis-${day(row.taken_on)}`) };
}

export async function deleteAllLabFiles(userId: number) {
  const { rows } = await pool.query(`delete from lab_files where user_id = $1 returning stored_name`, [userId]);
  for (const row of rows) await fs.rm(path.join(labsDir, path.basename(String(row.stored_name))), { force: true });
}

// подписанная ссылка на файл: тот же секрет, что у сессий, но kind «lab» — входа на сайт не даёт
export function labFileUrl(app: FastifyInstance, fileId: number) {
  return `/api/lab-file?t=${encodeURIComponent(app.jwt.sign({ kind: "lab", fileId } as never, { expiresIn: "30m" }))}`;
}
