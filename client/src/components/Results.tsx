import { PbGrid } from "./PbGrid";
import { FormEvent, useEffect, useRef, useState } from "react";

import { api } from "../api";
import { useApi } from "../hooks/useApi";
import { formatKm, pluralRu } from "../lib";
import { useToast } from "./ToastProvider";

export type RaceResult = {
  id: number;
  user_id: number;
  status: "planned" | "finished";
  race_date: string;
  name: string;
  city: string | null;
  distance_meters: number;
  official_time_seconds: number | null;
  goal_time_seconds: number | null;
  place_overall: number | null;
  participants: number | null;
  place_category: number | null;
  protocol_url: string | null;
  note: string | null;
  workout_id: number | null;
  is_record?: boolean;
};

type PersonalBest = {
  distanceMeters: number;
  label: string;
  result: RaceResult | null;
  improvementSeconds: number | null;
};

type ResultsData = { results: RaceResult[]; personalBests: PersonalBest[]; canEdit: boolean };

// Черновик результата, который форма получает снаружи (например, из пробежки)
export type ResultDraft = Partial<{
  status: "planned" | "finished";
  raceDate: string;
  name: string;
  distanceMeters: number;
  officialTimeSeconds: number;
  workoutId: number;
  // что записали часы — для подсказки «с часов: …»
  watchDistanceMeters: number;
}>;

const DISTANCES = [
  { meters: 1000, label: "1 км" },
  { meters: 3000, label: "3 км" },
  { meters: 5000, label: "5 км" },
  { meters: 10000, label: "10 км" },
  { meters: 21097, label: "21,1 км" },
  { meters: 42195, label: "42,2 км" }
];
const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

export function formatRaceTime(seconds: number | null | undefined) {
  if (!seconds) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

// «1:49:12», «49:12», «49.12» → секунды
export function parseRaceTime(value: string): number | null {
  const parts = value.trim().replace(/[.,]/g, ":").split(":").filter(Boolean).map(Number);
  if (!parts.length || parts.length > 3 || parts.some((part) => !Number.isFinite(part) || part < 0)) return null;
  const [h, m, s] = parts.length === 3 ? parts : parts.length === 2 ? [0, parts[0], parts[1]] : [0, parts[0], 0];
  if (m! >= 60 && parts.length === 3) return null;
  if (s! >= 60) return null;
  const total = h! * 3600 + m! * 60 + s!;
  return total > 0 ? total : null;
}

// На iPhone числовая клавиатура без двоеточия: набираем только цифры, двоеточия
// ставим сами — «4758» → «47:58», «14912» → «1:49:12»
export function formatTimeDigits(value: string) {
  const digits = value.replace(/\D/g, "").replace(/^0+(?=\d{3})/, "").slice(0, 6);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, -2)}:${digits.slice(-2)}`;
  return `${digits.slice(0, -4)}:${digits.slice(-4, -2)}:${digits.slice(-2)}`;
}

function distanceLabel(meters: number) {
  return DISTANCES.find((item) => Math.abs(item.meters - meters) / item.meters <= 0.02)?.label ?? `${formatKm(meters, meters % 1000 ? 2 : 0)} км`;
}

function dateParts(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return { year: year!, day: day!, month: MONTHS[month! - 1]! };
}

function daysUntil(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  const target = new Date(year!, month! - 1, day!);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function placeLabel(result: RaceResult) {
  if (result.place_overall && result.participants) {
    return `${result.place_overall.toLocaleString("ru-RU")} из ${result.participants.toLocaleString("ru-RU")}`;
  }
  if (result.place_overall) return `${result.place_overall} место`;
  if (result.place_category) return `${result.place_category} в категории`;
  return null;
}

const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

function longDate(iso: string) {
  const [, month, day] = iso.split("-").map(Number);
  return `${day} ${MONTHS_GEN[month! - 1]}`;
}

// цель «1:30» вместо «1:30:00»; секунды — только если они заданы
export function formatGoalTime(seconds: number) {
  return seconds >= 3600 && seconds % 60 === 0 ? formatRaceTime(seconds).slice(0, -3) : formatRaceTime(seconds);
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

// Старты: «Впереди» · «Личные рекорды» (по протоколу) · «Прошедшие» — всё списками.
// title — заголовок экрана с кнопкой «Добавить» (вкладка «Старты» у спортсмена)
export function ResultsPanel({
  athleteId,
  viewer,
  title
}: {
  athleteId: number;
  viewer: "self" | "trainer" | "teammate";
  title?: string;
}) {
  const { data, loading, error, refresh } = useApi<ResultsData>(`/api/results/athletes/${athleteId}`);
  const [editing, setEditing] = useState<{ result?: RaceResult; draft?: ResultDraft } | null>(null);
  const [openSeasons, setOpenSeasons] = useState<Set<number>>(new Set());

  const header = (canEdit: boolean) =>
    title ? (
      <div className="ds-head">
        <h1 className="ds-title">{title}</h1>
        {canEdit ? (
          <button type="button" className="ds-btn ds-btn-2 ds-btn-sm" onClick={() => setEditing({})}>
            <PlusIcon />
            Добавить
          </button>
        ) : null}
      </div>
    ) : null;

  const form = editing ? (
    <ResultForm
      athleteId={athleteId}
      result={editing.result}
      draft={editing.draft}
      onClose={() => setEditing(null)}
      onSaved={() => {
        setEditing(null);
        refresh();
      }}
    />
  ) : null;

  if (loading) return <div className="skeleton-block" style={{ height: 320, borderRadius: 16 }} />;
  if (error || !data) {
    return (
      <section className="ds-block ds-pad">
        <p className="ds-sub">{error || "Не удалось загрузить результаты"}</p>
      </section>
    );
  }

  const upcoming = data.results
    .filter((result) => result.status === "planned" && daysUntil(result.race_date) >= 0)
    .sort((a, b) => a.race_date.localeCompare(b.race_date));
  const finished = data.results.filter((result) => result.status === "finished");
  const latestRecordId = finished.find((result) => result.is_record)?.id;
  // сезоны — календарные годы, новый сверху; раскрыт текущий, прошлые — по нажатию
  const seasonMap = new Map<number, RaceResult[]>();
  for (const result of finished) {
    const { year } = dateParts(result.race_date);
    seasonMap.set(year, [...(seasonMap.get(year) ?? []), result]);
  }
  const seasons = [...seasonMap.entries()].sort((a, b) => b[0] - a[0]).map(([year, rows]) => ({ year, rows }));
  const recentDays = 30;
  const canEdit = data.canEdit;
  // старты добавляет сам спортсмен; тренер может только поправить уже внесённые
  const canAdd = canEdit && viewer !== "trainer";

  if (data.results.length === 0) {
    return (
      <div className="ds-screen" style={{ gap: 20, maxWidth: "none" }}>
        {header(false)}
        <section className="ds-block ds-pad">
          <b style={{ fontSize: 17 }}>{viewer === "teammate" ? "Результатов пока нет" : "Здесь будут старты и рекорды"}</b>
          {viewer === "teammate" ? null : (
            <p className="ds-sub" style={{ lineHeight: 1.45 }}>
              Добавьте прошедшие старты — личные рекорды на 5, 10, 21,1 и 42,2 км посчитаются сами, по официальному
              времени. Запланированный старт покажет отсчёт дней.
            </p>
          )}
          {canAdd ? (
            <button type="button" className="ds-btn ds-btn-1" style={{ marginTop: 14 }} onClick={() => setEditing({})}>
              <PlusIcon />
              Добавить старт
            </button>
          ) : null}
        </section>
        {form}
      </div>
    );
  }

  const editProps = (result: RaceResult) =>
    canEdit
      ? { type: "button" as const, onClick: () => setEditing({ result }), "aria-label": `Изменить: ${result.name}` }
      : { type: "button" as const, disabled: true };

  return (
    <div className="ds-screen" style={{ gap: 20, maxWidth: "none" }}>
      {header(canEdit)}

      {upcoming.length ? (
        <div>
          <div className="ds-grp">
            <span>Впереди</span>
          </div>
          <div className="ds-list">
            {upcoming.map((result) => {
              const days = daysUntil(result.race_date);
              return (
                <button key={result.id} className="ds-li" {...editProps(result)}>
                  <div className="st-cd">
                    <b>{days}</b>
                    <span>{days === 0 ? "сегодня" : pluralRu(days, "день", "дня", "дней")}</span>
                  </div>
                  <div className="ds-m">
                    <b>{result.name}</b>
                    <span>
                      {longDate(result.race_date)} · {distanceLabel(result.distance_meters)}
                      {result.goal_time_seconds ? ` · цель ${formatGoalTime(result.goal_time_seconds)}` : ""}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* рекорды — сплошная сетка 3×2; пустая клетка в своём кабинете добавляет результат на эту дистанцию */}
      <PbGrid
        bests={data.personalBests}
        freshDistance={data.personalBests.find((best) => best.result && best.result.id === latestRecordId && daysUntil(best.result.race_date) > -recentDays)?.distanceMeters ?? null}
        workoutHref={(id) => `/${viewer === "trainer" ? "trainer" : "athlete"}/workouts/${id}`}
        onEdit={canEdit ? (best) => best.result && setEditing({ result: best.result as RaceResult }) : undefined}
        onAdd={canAdd ? (meters) => setEditing({ draft: { status: "finished", distanceMeters: meters } }) : undefined}
      />

      {seasons.map(({ year, rows }, index) => {
        const summary = `${rows.length} ${pluralRu(rows.length, "старт", "старта", "стартов")}`;
        const open = index === 0 || openSeasons.has(year);
        if (!open) {
          const best = rows
            .filter((row) => row.official_time_seconds)
            .sort((a, b) => b.distance_meters - a.distance_meters)[0];
          return (
            <div key={year} className="ds-list">
              <button type="button" className="ds-li" onClick={() => setOpenSeasons((prev) => new Set(prev).add(year))}>
                <div className="ds-m">
                  <b>Сезон {year}</b>
                  <span>
                    {summary}
                    {best ? ` · ${distanceLabel(best.distance_meters)} за ${formatRaceTime(best.official_time_seconds)}` : ""}
                  </span>
                </div>
                <svg className="ds-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
            </div>
          );
        }
        return (
          <div key={year}>
            <div className="ds-grp">
              <span>Сезон {year}</span>
              <span>{summary}</span>
            </div>
            <div className="ds-list">
              {rows.map((result) => {
                const { day, month } = dateParts(result.race_date);
                const place = placeLabel(result);
                return (
                  <button key={result.id} className="ds-li" {...editProps(result)}>
                    <div className="ds-m">
                      <b>{result.name}</b>
                      <span>
                        {day} {month} · {distanceLabel(result.distance_meters)}
                        {place ? ` · ${place}` : ""}
                        {result.city ? ` · ${result.city}` : ""}
                      </span>
                    </div>
                    <div className="ds-v">
                      {formatRaceTime(result.official_time_seconds)}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {!title && canAdd ? (
        <button type="button" className="ds-btn ds-btn-2 ds-btn-full" onClick={() => setEditing({})}>
          <PlusIcon />
          Добавить старт
        </button>
      ) : null}

      {form}
    </div>
  );
}

type ResultFormProps = {
  athleteId: number;
  result?: RaceResult;
  draft?: ResultDraft;
  onClose: () => void;
  onSaved: () => void;
};

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function ResultForm({ athleteId, result, draft, onClose, onSaved }: ResultFormProps) {
  const showToast = useToast();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const initialMeters = result?.distance_meters ?? draft?.distanceMeters ?? 10000;
  const standard = DISTANCES.find((item) => Math.abs(item.meters - initialMeters) / item.meters <= 0.02);
  const [status, setStatus] = useState<"planned" | "finished">(result?.status ?? draft?.status ?? "finished");
  const [name, setName] = useState(result?.name ?? draft?.name ?? "");
  const [distance, setDistance] = useState<number | "custom">(standard ? standard.meters : "custom");
  const [customKm, setCustomKm] = useState(standard ? "" : String(Math.round(initialMeters / 10) / 100).replace(".", ","));
  const [raceDate, setRaceDate] = useState(result?.race_date ?? draft?.raceDate ?? todayIso());
  const [time, setTime] = useState(formatRaceTime(result?.official_time_seconds ?? draft?.officialTimeSeconds ?? null).replace("—", ""));
  const [goal, setGoal] = useState(formatRaceTime(result?.goal_time_seconds ?? null).replace("—", ""));
  const [placeOverall, setPlaceOverall] = useState(result?.place_overall ? String(result.place_overall) : "");
  const [participants, setParticipants] = useState(result?.participants ? String(result.participants) : "");
  const [placeCategory, setPlaceCategory] = useState(result?.place_category ? String(result.place_category) : "");
  const [city, setCity] = useState(result?.city ?? "");
  const [protocolUrl, setProtocolUrl] = useState(result?.protocol_url ?? "");
  const [note, setNote] = useState(result?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const watchSeconds = draft?.officialTimeSeconds;
  const intOrNull = (value: string) => (value.trim() ? Number.parseInt(value, 10) || null : null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError("");
    const meters = distance === "custom" ? Math.round(Number(customKm.replace(",", ".")) * 1000) : distance;
    if (!meters || meters < 100) return setFormError("Укажите дистанцию");
    const officialTimeSeconds = status === "finished" ? parseRaceTime(time) : null;
    if (status === "finished" && !officialTimeSeconds) return setFormError("Укажите время по протоколу, например 47:58 или 1:49:12");
    const goalTimeSeconds = goal.trim() ? parseRaceTime(goal) : null;
    if (goal.trim() && !goalTimeSeconds) return setFormError("Цель — в формате 1:45:00 или 52:00");

    const body = {
      status,
      raceDate,
      name: name.trim(),
      city: city.trim() || null,
      distanceMeters: meters,
      officialTimeSeconds,
      goalTimeSeconds,
      placeOverall: intOrNull(placeOverall),
      participants: intOrNull(participants),
      placeCategory: intOrNull(placeCategory),
      protocolUrl: protocolUrl.trim() || null,
      note: note.trim() || null,
      workoutId: result?.workout_id ?? draft?.workoutId ?? null
    };
    setBusy(true);
    try {
      await api(result ? `/api/results/${result.id}` : `/api/results/athletes/${athleteId}`, {
        method: result ? "PUT" : "POST",
        body: JSON.stringify(body)
      });
      showToast("success", status === "planned" ? "Старт добавлен в план" : "Результат сохранён");
      onSaved();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!result || !window.confirm(`Удалить «${result.name}»?`)) return;
    setBusy(true);
    try {
      await api(`/api/results/${result.id}`, { method: "DELETE" });
      onSaved();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Не удалось удалить");
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialogRef} className="sheet" onClose={onClose} onCancel={onClose} aria-labelledby="result-form-title">
      <form className="sheet-body" onSubmit={submit}>
        <div className="sheet-head">
          <h2 id="result-form-title">{result ? "Изменить результат" : draft?.workoutId ? "Это был старт" : "Новый результат"}</h2>
          <button type="button" className="icon-button" aria-label="Закрыть" onClick={() => dialogRef.current?.close()}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {watchSeconds && (draft?.watchDistanceMeters ?? draft?.distanceMeters) ? (
          <p className="sheet-note">
            С часов: <b>{formatKm(draft!.watchDistanceMeters ?? draft!.distanceMeters!, 2)} км · {formatRaceTime(watchSeconds)}</b>. Поправьте время по
            протоколу — рекорды считаются по нему.
          </p>
        ) : null}

        <div className="segmented segmented-full" role="radiogroup" aria-label="Статус">
          {(["finished", "planned"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={status === value}
              className={status === value ? "segmented-item is-active" : "segmented-item"}
              onClick={() => setStatus(value)}
            >
              {value === "finished" ? "Пробежал" : "Планирую"}
            </button>
          ))}
        </div>

        <label className="field">
          Название старта
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} placeholder="Например, Уфимский полумарафон" />
        </label>

        <fieldset className="field">
          <legend>Дистанция</legend>
          <div className="chip-row">
            {DISTANCES.map((item) => (
              <button
                key={item.meters}
                type="button"
                className={distance === item.meters ? "chip is-active" : "chip"}
                aria-pressed={distance === item.meters}
                onClick={() => setDistance(item.meters)}
              >
                {item.label}
              </button>
            ))}
            <button
              type="button"
              className={distance === "custom" ? "chip is-active" : "chip"}
              aria-pressed={distance === "custom"}
              onClick={() => setDistance("custom")}
            >
              Другая
            </button>
          </div>
          {distance === "custom" ? (
            <input inputMode="decimal" value={customKm} onChange={(e) => setCustomKm(e.target.value)} placeholder="Км, например 15" aria-label="Дистанция, км" />
          ) : null}
        </fieldset>

        <div className="field-row">
          {status === "finished" ? (
            <label className="field">
              Время по чипу
              <input inputMode="numeric" value={time} onChange={(e) => setTime(formatTimeDigits(e.target.value))} placeholder="47:58" className="num" aria-describedby="time-hint" />
            </label>
          ) : (
            <label className="field">
              Цель
              <input inputMode="numeric" value={goal} onChange={(e) => setGoal(formatTimeDigits(e.target.value))} placeholder="1:45:00" className="num" aria-describedby="time-hint" />
            </label>
          )}
          <label className="field">
            Дата
            <input type="date" value={raceDate} onChange={(e) => setRaceDate(e.target.value)} required />
          </label>
        </div>

        <p id="time-hint" className="field-hint">Время — только цифры, двоеточия встанут сами: 4758 → 47:58</p>

        {status === "finished" ? (
          <div className="field-row field-row-3">
            <label className="field">
              Место
              <input inputMode="numeric" value={placeOverall} onChange={(e) => setPlaceOverall(e.target.value)} placeholder="необяз." />
            </label>
            <label className="field">
              Участников
              <input inputMode="numeric" value={participants} onChange={(e) => setParticipants(e.target.value)} placeholder="необяз." />
            </label>
            <label className="field">
              В категории
              <input inputMode="numeric" value={placeCategory} onChange={(e) => setPlaceCategory(e.target.value)} placeholder="необяз." />
            </label>
          </div>
        ) : null}

        <label className="field">
          Город
          <input value={city} onChange={(e) => setCity(e.target.value)} maxLength={80} placeholder="Необязательно" />
        </label>
        <label className="field">
          Ссылка на протокол
          <input type="url" value={protocolUrl} onChange={(e) => setProtocolUrl(e.target.value)} placeholder="https://…" />
        </label>
        <label className="field">
          Заметка
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Как прошло — необязательно" />
        </label>

        {formError ? <p className="error-box">{formError}</p> : null}

        <div className="sheet-actions">
          <button type="submit" className="primary-button" disabled={busy}>
            {busy ? "Сохраняем…" : status === "planned" ? "Добавить в план" : "Сохранить результат"}
          </button>
          {result ? (
            <button type="button" className="danger-link" disabled={busy} onClick={() => void remove()}>
              Удалить
            </button>
          ) : null}
        </div>
      </form>
    </dialog>
  );
}
