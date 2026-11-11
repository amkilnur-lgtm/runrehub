import { type ChangeEvent, useEffect, useRef, useState } from "react";

import { api } from "../api";
import { User } from "../types";
import { AvatarCropModal } from "./AvatarCropModal";
import { useAuth } from "./AuthProvider";
import { useToast } from "./ToastProvider";
import { useNavigate } from "react-router-dom";

import { BirthdayDialog } from "./BirthdayDialog";
import { UserAvatar } from "./UserAvatar";

type EditableAvatarMenuProps = {
  fullName: string | null | undefined;
  avatarUrl?: string | null;
  className?: string;
  // «photo» — большое фото в профиле: значок камеры, в меню только «Изменить / Удалить фото»
  variant?: "menu" | "photo";
};

export function EditableAvatarMenu(props: EditableAvatarMenuProps) {
  const { fullName, avatarUrl, className, variant = "menu" } = props;
  const photoOnly = variant === "photo";
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const showToast = useToast();
  const [birthdayOpen, setBirthdayOpen] = useState(false);
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
    <div className={photoOnly ? "avatar-menu is-photo" : "avatar-menu"} ref={avatarMenuRef}>
      <button
        type="button"
        className="avatar-menu-trigger"
        aria-label={currentAvatarUrl ? "Фото профиля" : "Добавить фото профиля"}
        aria-expanded={isAvatarMenuOpen}
        onClick={() => {
          // без фото в профиле — сразу выбор файла, меню не нужно
          if (photoOnly && !currentAvatarUrl) handleAvatarPickClick();
          else setIsAvatarMenuOpen((open) => !open);
        }}
      >
        <UserAvatar fullName={fullName} avatarUrl={currentAvatarUrl} className={className} ariaHidden />
        {photoOnly ? (
          <span className="avatar-cam" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
          </span>
        ) : null}
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
      {birthdayOpen ? <BirthdayDialog endpoint="/api/auth/birthday" onClose={() => setBirthdayOpen(false)} /> : null}
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
          {photoOnly ? null : user?.role === "athlete" ? (
            <button
              type="button"
              className="avatar-menu-item"
              onClick={() => {
                setIsAvatarMenuOpen(false);
                navigate("/athlete/profile");
              }}
            >
              Мой профиль
            </button>
          ) : (
            <button
              type="button"
              className="avatar-menu-item"
              onClick={() => {
                setIsAvatarMenuOpen(false);
                setBirthdayOpen(true);
              }}
            >
              День рождения
            </button>
          )}
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
