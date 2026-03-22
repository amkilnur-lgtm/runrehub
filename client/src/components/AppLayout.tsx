import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";

import { api } from "../api";
import { User } from "../types";
import { useAuth } from "./AuthProvider";
import { UserAvatar } from "./UserAvatar";

export function AppLayout() {
  const { user, logout, setUser } = useAuth();
  const navigate = useNavigate();
  const [isAvatarMenuOpen, setIsAvatarMenuOpen] = useState(false);
  const [isAvatarBusy, setIsAvatarBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const avatarMenuRef = useRef<HTMLDivElement | null>(null);

  async function handleLogout() {
    await logout();
    navigate("/");
  }

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
      setIsAvatarMenuOpen(false);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Не удалось загрузить фото");
    } finally {
      setIsAvatarBusy(false);
    }
  }

  async function handleAvatarDelete() {
    if (!user?.avatarUrl || isAvatarBusy) {
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
      setIsAvatarMenuOpen(false);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Не удалось удалить фото");
    } finally {
      setIsAvatarBusy(false);
    }
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-identity">
          <div className="eyebrow">RunningRehab</div>
          <div className="topbar-actions">
            <button className="ghost-button topbar-logout" onClick={handleLogout}>
              <svg
                viewBox="0 0 24 24"
                className="topbar-logout-icon"
                aria-hidden="true"
              >
                <path
                  d="M10 4H5v16h5M13 8l4 4-4 4M9 12h8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Выйти
            </button>
          </div>
        </div>
        <div className="topbar-main-row">
          <div className="topbar-left-group">
            <div className="topbar-name-box">
              <div className="avatar-menu" ref={avatarMenuRef}>
                <button
                  type="button"
                  className="avatar-menu-trigger"
                  aria-label={user?.avatarUrl ? "Фото профиля" : "Добавить фото профиля"}
                  aria-expanded={isAvatarMenuOpen}
                  onClick={() => setIsAvatarMenuOpen((open) => !open)}
                >
                  <UserAvatar
                    fullName={user?.fullName}
                    avatarUrl={user?.avatarUrl}
                    className="topbar-avatar"
                    ariaHidden
                  />
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
                      {user?.avatarUrl ? "Изменить фото" : "Загрузить фото"}
                    </button>
                    {user?.avatarUrl ? (
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
              <h1>{user?.fullName}</h1>
            </div>
          </div>
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
