import { useRef, useState } from "react";

import { useToast } from "./ToastProvider";

// Анализы — файлами: фото или PDF бланка лаборатории. Числа руками не вводим.
// Файл открывается по подписанной ссылке (в Telegram — во встроенном браузере: там PDF листается и сохраняется).
export type LabFile = {
  id: number;
  taken_on: string;
  title: string | null;
  mime: string;
  size_bytes: number;
  original_name: string | null;
  url: string;
};

const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
function dateLabel(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  return `${d} ${MONTHS[m! - 1]} ${y}`;
}
function sizeLabel(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} МБ` : `${Math.max(1, Math.round(bytes / 1024))} КБ`;
}

export function openLabFile(url: string) {
  const absolute = new URL(url, window.location.origin).toString();
  const tg = (window as unknown as { Telegram?: { WebApp?: { initData?: string; openLink?: (u: string) => void } } }).Telegram?.WebApp;
  if (tg?.initData && tg.openLink) tg.openLink(absolute);
  else window.open(absolute, "_blank", "noopener");
}

function FileIcon({ pdf }: { pdf: boolean }) {
  return (
    <span className={pdf ? "lf-ic is-pdf" : "lf-ic"} aria-hidden="true">
      {pdf ? "PDF" : (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <circle cx="9" cy="10" r="1.6" />
          <path d="M21 16l-5-5-8 8" />
        </svg>
      )}
    </span>
  );
}

export function LabFileList({ files, onDelete }: { files: LabFile[]; onDelete?: (id: number) => void }) {
  return (
    <>
      {files.map((file) => (
        <div key={file.id} className="ds-li lf-row">
          <button type="button" className="lf-open" onClick={() => openLabFile(file.url)}>
            <FileIcon pdf={file.mime === "application/pdf"} />
            <div className="ds-m">
              <b>{file.title || "Анализы"}</b>
              <span>
                {dateLabel(file.taken_on)} · {sizeLabel(file.size_bytes)}
              </span>
            </div>
          </button>
          {onDelete ? (
            <button
              type="button"
              className="lf-del"
              aria-label="Удалить файл"
              onClick={() => {
                if (window.confirm("Удалить файл анализов?")) onDelete(file.id);
              }}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          ) : null}
        </div>
      ))}
    </>
  );
}

// Прикрепить: выбрать файл → дата сдачи (сегодня) и подпись по желанию → «Сохранить»
export function LabFileUpload<T>({ onUploaded }: { onUploaded: (next: T) => void }) {
  const showToast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [title, setTitle] = useState("");
  const [sending, setSending] = useState(false);

  async function upload() {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      showToast("error", "Файл больше 10 МБ");
      return;
    }
    setSending(true);
    try {
      const params = new URLSearchParams({ taken_on: date });
      if (title.trim()) params.set("title", title.trim());
      const res = await fetch(`/api/auth/health/lab-files?${params}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": file.type || "application/octet-stream", "X-File-Name": encodeURIComponent(file.name) },
        body: file
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { message?: string }).message ?? "Не удалось загрузить");
      onUploaded(data as T);
      setFile(null);
      setTitle("");
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Не удалось загрузить");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*,application/pdf"
        hidden
        onChange={(event) => {
          setFile(event.target.files?.[0] ?? null);
          event.target.value = "";
        }}
      />
      {file ? (
        <div className="hl-form lf-form">
          <div className="lf-picked">
            <FileIcon pdf={file.type === "application/pdf"} />
            <div className="ds-m">
              <b>{file.name}</b>
              <span>{sizeLabel(file.size)}</span>
            </div>
          </div>
          <label className="hl-date">
            <span>дата сдачи</span>
            <input type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label className="hl-date">
            <span>подпись, если нужно</span>
            <input value={title} maxLength={80} placeholder="Общий анализ крови" onChange={(event) => setTitle(event.target.value)} />
          </label>
          <div className="bd-actions">
            <button type="button" className="ds-btn ds-btn-1" disabled={sending} onClick={() => void upload()}>
              {sending ? "Загружаем…" : "Сохранить"}
            </button>
            <button type="button" className="ds-btn ds-btn-3" disabled={sending} onClick={() => setFile(null)}>
              Отмена
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="ds-li mate-more hl-add" onClick={() => input.current?.click()}>
          + Прикрепить анализы — фото или PDF
        </button>
      )}
    </>
  );
}
