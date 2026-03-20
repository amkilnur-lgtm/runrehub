import fs from "node:fs/promises";
import path from "node:path";

const ALLOWED_MIME_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"]
]);
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

const uploadsRoot = path.join(process.cwd(), "server", "uploads");
const avatarsDir = path.join(uploadsRoot, "avatars");
const avatarUrlPrefix = "/uploads/avatars/";

function parseAvatarDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    throw new Error("Поддерживаются только JPG, PNG или WEBP");
  }

  const [, mimeType, base64Payload] = match;
  const extension = ALLOWED_MIME_TYPES.get(mimeType);
  if (!extension) {
    throw new Error("Неподдерживаемый формат изображения");
  }

  const buffer = Buffer.from(base64Payload, "base64");
  if (buffer.length === 0) {
    throw new Error("Файл пустой");
  }
  if (buffer.length > MAX_AVATAR_BYTES) {
    throw new Error("Файл слишком большой. Максимум 2 МБ");
  }

  return { buffer, extension };
}

function avatarFilePathFromUrl(avatarUrl: string) {
  if (!avatarUrl.startsWith(avatarUrlPrefix)) {
    return null;
  }

  const fileName = path.basename(avatarUrl);
  return path.join(avatarsDir, fileName);
}

export function getAvatarUploadsRoot() {
  return uploadsRoot;
}

export async function saveAvatarFromDataUrl(userId: number, dataUrl: string) {
  const { buffer, extension } = parseAvatarDataUrl(dataUrl);
  await fs.mkdir(avatarsDir, { recursive: true });

  const fileName = `user-${userId}-${Date.now()}.${extension}`;
  const filePath = path.join(avatarsDir, fileName);
  await fs.writeFile(filePath, buffer);

  return `${avatarUrlPrefix}${fileName}`;
}

export async function removeAvatarFile(avatarUrl: string | null | undefined) {
  if (!avatarUrl) {
    return;
  }

  const filePath = avatarFilePathFromUrl(avatarUrl);
  if (!filePath) {
    return;
  }

  await fs.rm(filePath, { force: true });
}
