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
    <span className={classes} aria-hidden={ariaHidden}>
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
