import { createHmac, timingSafeEqual } from "node:crypto";

import { pool } from "./db.js";

// Данные запуска Mini App старше суток не принимаем: подпись не даёт
// переиспользовать украденную строку initData бесконечно
const INIT_DATA_MAX_AGE_SECONDS = 24 * 60 * 60;

export type TelegramWebAppUser = {
  id: number;
  username: string | null;
  firstName: string | null;
};

// Проверка подписи initData по документации Telegram:
// secret = HMAC_SHA256(key="WebAppData", bot_token),
// hash = HMAC_SHA256(key=secret, все поля кроме hash, отсортированные, "key=value" через \n)
export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): TelegramWebAppUser | null {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) {
    return null;
  }
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(dataCheckString).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, "hex"))) {
    return null;
  }

  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate) || nowSeconds - authDate > INIT_DATA_MAX_AGE_SECONDS) {
    return null;
  }

  try {
    const user = JSON.parse(params.get("user") ?? "null");
    if (!user || !Number.isSafeInteger(user.id)) {
      return null;
    }
    return {
      id: user.id,
      username: typeof user.username === "string" ? user.username : null,
      firstName: typeof user.first_name === "string" ? user.first_name : null
    };
  } catch {
    return null;
  }
}

// "@Max_Runner", "t.me/max_runner", "https://t.me/max_runner" → "max_runner"
export function normalizeTelegramUsername(value: string): string | null {
  const cleaned = value
    .trim()
    .replace(/^(https?:\/\/)?(www\.)?t(elegram)?\.me\//i, "")
    .replace(/^@/, "")
    .toLowerCase();
  return /^[a-z0-9_]{4,32}$/.test(cleaned) ? cleaned : null;
}

// Ищем, к кому привязан этот Telegram: сначала по id, а при первом входе — по нику,
// который админ вписал заранее (и тогда сразу запоминаем id)
export async function findUserIdForTelegram(telegramUser: TelegramWebAppUser): Promise<number | null> {
  const byId = await pool.query(`select id from users where telegram_user_id = $1`, [telegramUser.id]);
  if (byId.rows[0]) {
    return byId.rows[0].id;
  }

  const username = telegramUser.username ? normalizeTelegramUsername(telegramUser.username) : null;
  if (!username) {
    return null;
  }
  const { rows } = await pool.query(
    `
      update users set telegram_user_id = $2
      where lower(telegram_username) = $1 and telegram_user_id is null
      returning id
    `,
    [username, telegramUser.id]
  );
  return rows[0]?.id ?? null;
}

// Вход паролем изнутри Mini App: привязываем Telegram к этому аккаунту,
// если он ещё ни к кому не привязан, а у аккаунта нет другого Telegram
export async function linkTelegramToUser(userId: number, telegramUser: TelegramWebAppUser) {
  const username = telegramUser.username ? normalizeTelegramUsername(telegramUser.username) : null;
  await pool.query(
    `
      update users
      set telegram_user_id = $2,
          telegram_username = case
            when telegram_username is null and $3::text is not null and not exists (
              select 1 from users other where other.id <> $1 and lower(other.telegram_username) = $3
            ) then $3
            else telegram_username
          end
      where id = $1
        and telegram_user_id is null
        and not exists (select 1 from users other where other.telegram_user_id = $2)
    `,
    [userId, telegramUser.id, username]
  );
}
