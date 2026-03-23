import { type ChangeEvent, useEffect, useRef, useState } from "react";

import { api } from "../api";
import { User } from "../types";
import { useAuth } from "./AuthProvider";
import { UserAvatar } from "./UserAvatar";

type EditableAvatarMenuProps = {
  fullName: string | null | undefined;
  avatarUrl?: string | null;
  className?: string;
};

export function EditableAvatarMenu(props: EditableAvatarMenuProps) {
  const { fullName, avatarUrl, className } = props;
  const { setUser } = useAuth();
  const [isAvatarMenuOpen, setIsAvatarMenuOpen] = useState(false);
  const [isAvatarBusy, setIsAvatarBusy] = useState(false);
  const [currentAvatarUrl, setCurrentAvatarUrl] = useState<string | null>(avatarUrl ?? null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const avatarMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setCurrentAvatarUrl(avatarUrl ?? null);
  }, [avatarUrl]);

  useEffect(() => {
    if (!isAvatarMenuOpen) {
      return undefined;
    }

    function handlePointerDown(event: MouseEvent) {
      if (avatarMenuRef.current && !avatarMenuRef.current.contains(event.target as Node)) {
        setIsAvatarMenuOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsAvatarMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isAvatarMenuOpen]);

  function handleAvatarPickClick() {
    if (isAvatarBusy) {
      return;
    }
    fileInputRef.current?.click();
  }

  async function fileToDataUrl(file: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          resolve(reader.result);
          return;
        }
        reject(new Error("Не удалось прочитать файл"));
      };
      reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
      reader.readAsDataURL(file);
    });
  }

  async function handleAvatarChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || isAvatarBusy) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      window.alert("Можно загружать только изображения");
      return;
    }

    setIsAvatarBusy(true);
    try {
      const imageDataUrl = await fileToDataUrl(file);
      const result = await api<{ user: User }>("/api/auth/avatar", {
        method: "PUT",
        body: JSON.stringify({ imageDataUrl })
      });
      setUser(result.user);
      setCurrentAvatarUrl(result.user.avatarUrl);
      setIsAvatarMenuOpen(false);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Не удалось загрузить фото");
    } finally {
      setIsAvatarBusy(false);
    }
  }

  async function handleAvatarDelete() {
    if (!currentAvatarUrl || isAvatarBusy) {
      return;
    }

    const confirmed = window.confirm("Удалить фото профиля?");
    if (!confirmed) {
      return;
    }

    setIsAvatarBusy(true);
    try {
      const result = await api<{ user: User }>("/api/auth/avatar", {
        method: "DELETE"
      });
      setUser(result.user);
      setCurrentAvatarUrl(result.user.avatarUrl);
      setIsAvatarMenuOpen(false);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Не удалось удалить фото");
    } finally {
      setIsAvatarBusy(false);
    }
  }

  return (
    <div className="avatar-menu" ref={avatarMenuRef}>
      <button
        type="button"
        className="avatar-menu-trigger"
        aria-label={currentAvatarUrl ? "Фото профиля" : "Добавить фото профиля"}
        aria-expanded={isAvatarMenuOpen}
        onClick={() => setIsAvatarMenuOpen((open) => !open)}
      >
        <UserAvatar fullName={fullName} avatarUrl={currentAvatarUrl} className={className} ariaHidden />
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="avatar-file-input"
        onChange={handleAvatarChange}
      />
      {isAvatarMenuOpen ? (
        <div className="avatar-menu-popover">
          <button
            type="button"
            className="avatar-menu-item"
            disabled={isAvatarBusy}
            onClick={handleAvatarPickClick}
          >
            {currentAvatarUrl ? "Изменить фото" : "Загрузить фото"}
          </button>
          {currentAvatarUrl ? (
            <button
              type="button"
              className="avatar-menu-item avatar-menu-item-danger"
              disabled={isAvatarBusy}
              onClick={handleAvatarDelete}
            >
              Удалить фото
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
