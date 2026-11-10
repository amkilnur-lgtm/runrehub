import { useEffect, useState } from "react";

function getInitials(fullName: string | null | undefined) {
  const parts = (fullName ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return "??";
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

// Без фото — инициалы на постоянном цвете по имени (как в макетах): человека проще узнать в списке.
// Приглушённые тона, белый текст на всех — контраст от 4,5:1
const AVATAR_TONES = ["#b8432f", "#0f6f78", "#6a3e9e", "#9a5b0c", "#2d4a86", "#2a7a3b", "#8a3a62", "#4a5470"];

function toneFor(name: string | null | undefined) {
  let hash = 0;
  for (const char of name ?? "") hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length]!;
}

export function UserAvatar({
  fullName,
  avatarUrl,
  className = "",
  ariaHidden = false
}: {
  fullName: string | null | undefined;
  avatarUrl?: string | null;
  className?: string;
  ariaHidden?: boolean;
}) {
  const initials = getInitials(fullName);
  const classes = ["user-avatar", className].filter(Boolean).join(" ");
  const [imageVisible, setImageVisible] = useState(Boolean(avatarUrl));

  useEffect(() => {
    setImageVisible(Boolean(avatarUrl));
  }, [avatarUrl]);

  return (
    <span
      className={avatarUrl && imageVisible ? classes : `${classes} is-initials`}
      aria-hidden={ariaHidden}
      style={avatarUrl && imageVisible ? undefined : { background: toneFor(fullName), color: "#fff" }}
    >
      {avatarUrl && imageVisible ? (
        <img
          className="user-avatar-image"
          src={avatarUrl}
          alt=""
          onError={() => setImageVisible(false)}
        />
      ) : (
        initials
      )}
    </span>
  );
}
