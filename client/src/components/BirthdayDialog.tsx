import { useEffect, useState } from "react";

import { api } from "../api";
import { useToast } from "./ToastProvider";

const MONTHS = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

export type Birthday = {
  day: number | null;
  month: number | null;
  hidden: boolean;
};

// День рождения: только день и месяц, год не спрашиваем. «Показывать клубу» включено по умолчанию,
// тренер видит дату всегда. endpoint — свой (/api/auth/birthday) или спортсмена у тренера.
export function BirthdayDialog({
  endpoint,
  initial,
  title = "День рождения",
  onClose,
  onSaved,
}: {
  endpoint: string;
  initial?: Birthday | null;
  title?: string;
  onClose: () => void;
  onSaved?: (value: Birthday) => void;
}) {
  const showToast = useToast();
  const [day, setDay] = useState<number | "">(initial?.day ?? "");
  const [month, setMonth] = useState<number | "">(initial?.month ?? "");
  const [hidden, setHidden] = useState(initial?.hidden ?? false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(Boolean(initial));

  useEffect(() => {
    if (initial) return;
    api<Birthday>(endpoint)
      .then((value) => {
        setDay(value.day ?? "");
        setMonth(value.month ?? "");
        setHidden(value.hidden);
      })
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, [endpoint, initial]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const daysInMonth = month ? new Date(2024, month, 0).getDate() : 31;

  async function save(clear = false) {
    const value: Birthday = clear
      ? { day: null, month: null, hidden: false }
      : {
          day: day === "" ? null : day,
          month: month === "" ? null : month,
          hidden,
        };
    if (!clear && (value.day === null || value.month === null)) {
      showToast("error", "Выберите день и месяц");
      return;
    }
    setSaving(true);
    try {
      await api(endpoint, { method: "PUT", body: JSON.stringify(value) });
      onSaved?.(value);
      onClose();
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : "Не удалось сохранить",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="bd-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="bd-sheet ds-block ds-pad"
        onClick={(event) => event.stopPropagation()}
      >
        <b className="bd-title">{title}</b>
        <div className="bd-row">
          <label>
            <span>день</span>
            <select
              value={day}
              disabled={!loaded}
              onChange={(event) =>
                setDay(event.target.value ? Number(event.target.value) : "")
              }
            >
              <option value="">—</option>
              {Array.from({ length: daysInMonth }, (_, index) => index + 1).map(
                (value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ),
              )}
            </select>
          </label>
          <label>
            <span>месяц</span>
            <select
              value={month}
              disabled={!loaded}
              onChange={(event) => {
                const next = event.target.value
                  ? Number(event.target.value)
                  : "";
                setMonth(next);
                if (next && day && day > new Date(2024, next, 0).getDate())
                  setDay("");
              }}
            >
              <option value="">—</option>
              {MONTHS.map((name, index) => (
                <option key={name} value={index + 1}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="bd-check">
          <input
            type="checkbox"
            checked={!hidden}
            onChange={(event) => setHidden(!event.target.checked)}
          />
          <span>Показывать клубу</span>
        </label>
        <p className="bd-note">
          Клуб увидит только день и месяц. Тренер видит дату всегда и получит
          напоминание накануне.
        </p>
        <div className="bd-actions">
          <button
            type="button"
            className="ds-btn ds-btn-1"
            disabled={saving || !loaded}
            onClick={() => void save()}
          >
            {saving ? "Сохраняем…" : "Сохранить"}
          </button>
          <button type="button" className="ds-btn ds-btn-3" onClick={onClose}>
            Отмена
          </button>
          {initial?.day || day ? (
            <button
              type="button"
              className="ds-btn ds-btn-3 bd-clear"
              disabled={saving}
              onClick={() => void save(true)}
            >
              Удалить
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
