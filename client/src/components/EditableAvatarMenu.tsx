import { type ChangeEvent, useEffect, useRef, useState } from "react";

import { api } from "../api";
import { User } from "../types";
import { AvatarCropModal } from "./AvatarCropModal";
import { useAuth } from "./AuthProvider";
import { useToast } from "./ToastProvider";
import { UserAvatar } from "./UserAvatar";

type EditableAvatarMenuProps = {
  fullName: string | null | undefined;
  avatarUrl?: string | null;
  className?: string;
};

export function EditableAvatarMenu(props: EditableAvatarMenuProps) {
  const { fullName, avatarUrl, className } = props;
  const { setUser } = useAuth();
  const showToast = useToast();
  const [isAvatarMenuOpen, setIsAvatarMenuOpen] = useState(false);
  const [isAvatarBusy, setIsAvatarBusy] = useState(false);
  const [currentAvatarUrl, setCurrentAvatarUrl] = useState<string | null>(avatarUrl ?? null);
  const [cropFile, setCropFile] = useState<File | null>(null);
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

  function handleAvatarChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || isAvatarBusy) {
      return;
    }
    // некоторые телефоны отдают HEIC с пустым/нестандартным type — открываем в кропе,
    // где canvas всё равно пережмёт в JPEG; фильтруем только явно не-картинки
    if (file.type && !file.type.startsWith("image/")) {
      showToast("error", "Можно загружать только изображения");
      return;
    }
    setIsAvatarMenuOpen(false);
    setCropFile(file);
  }

  async function handleCropConfirm(imageDataUrl: string) {
    setIsAvatarBusy(true);
    try {
      const result = await api<{ user: User }>("/api/auth/avatar", {
        method: "PUT",
        body: JSON.stringify({ imageDataUrl })
      });
      setUser(result.user);
      setCurrentAvatarUrl(result.user.avatarUrl);
      setCropFile(null);
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Не удалось загрузить фото");
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
      showToast("error", error instanceof Error ? error.message : "Не удалось удалить фото");
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
        accept="image/*"
        className="avatar-file-input"
        onChange={handleAvatarChange}
      />
      {cropFile ? (
        <AvatarCropModal
          file={cropFile}
          busy={isAvatarBusy}
          onCancel={() => setCropFile(null)}
          onConfirm={handleCropConfirm}
        />
      ) : null}
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
