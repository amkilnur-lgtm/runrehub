import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_HR_ZONES, zoneIndex, zoneRangeLabels, zonesSourceNote, type AthleteHrZones } from "../lib-hrzones";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { api } from "../api";
import { isTelegramMiniApp } from "../telegram";
import { useAuth } from "../components/AuthProvider";
import { ResultForm } from "../components/Results";
import { ShareStoryButton } from "../components/ShareStoryButton";
import { StreamChart } from "../components/StreamChart";
import { useToast } from "../components/ToastProvider";
import { CoachChat } from "../components/CoachChat";
import { WorkoutComments } from "../components/WorkoutComments";
import { WorkoutFeeling } from "../components/WorkoutFeeling";
import { prepareHeartRateChart } from "../chart/heartrate-chart";
import { buildIntervalBands } from "../chart/interval-bands";
import { formatPaceSeconds, preparePaceChart } from "../chart/pace-chart";
import { forgetApiCache, useApi } from "../hooks/useApi";
import { formatDistance, formatDuration, formatPace, pluralRu } from "../lib";
import { WorkoutData } from "../types/workout";

const WorkoutRouteMap = lazy(async () =>
  import("../components/WorkoutRouteMap").then((module) => ({ default: module.WorkoutRouteMap }))
);

function formatLapElevation(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }

  // круг хранит разницу высоты (конец − начало), поэтому со знаком: «+12», «−7»
  const rounded = Math.round(value);
  if (rounded === 0) {
    return "0";
  }

  return rounded > 0 ? `+${rounded}` : `−${Math.abs(rounded)}`;
}

function formatLapDistanceKilometers(distanceMeters: number) {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
    return "0.00";
  }

  return (distanceMeters / 1000).toFixed(2);
}

function formatLapTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "—";
  }

  const totalSeconds = Math.round(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

function longWorkoutDate(date: Date) {
  const time = date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return `${WEEKDAYS[date.getDay()]}, ${date.getDate()} ${MONTHS_GEN[date.getMonth()]} · ${time}`;
}

function formatKmShort(meters: number) {
  return (meters / 1000).toLocaleString("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: meters >= 100000 ? 0 : 2 });
}

type HrZoneShare = { label: string; percent: number };

export function heartRateZones(streams: WorkoutData["streams"], zones: AthleteHrZones | null | undefined): HrZoneShare[] | null {
  const bounds = (zones ?? DEFAULT_HR_ZONES).bounds;
  const hr = streams?.heartrate ?? [];
  const time = streams?.time ?? [];
  const size = Math.min(hr.length, time.length);
  if (size < 30) return null;
  const seconds = [0, 0, 0, 0, 0];
  for (let index = 1; index < size; index += 1) {
    const dt = time[index]! - time[index - 1]!;
    const bpm = hr[index]!;
    if (!(dt > 0 && dt <= 30) || !(bpm >= 60 && bpm <= 230)) continue;
    seconds[zoneIndex(bpm, bounds)] += dt;
  }
  const total = seconds.reduce((sum, value) => sum + value, 0);
  if (total < 60) return null;
  // проценты в сумме ровно 100
  const raw = seconds.map((value) => (value / total) * 100);
  const percents = raw.map(Math.floor);
  let rest = 100 - percents.reduce((sum, value) => sum + value, 0);
  raw
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac)
    .forEach(({ index }) => {
      if (rest > 0) {
        percents[index] += 1;
        rest -= 1;
      }
    });
  const labels = zoneRangeLabels(bounds);
  return labels.map((label, index) => ({ label: `${index + 1} · ${label}`, percent: percents[index]! }));
}

function paceOf(speed: number | null | undefined) {
  return speed && speed > 0 ? 1000 / speed : null;
}

// время движения круга: при стоянке внутри круга elapsed включает отдых
export function lapMovingSeconds(lap: WorkoutData["laps"][number]) {
  return lap.average_speed ? Math.min(lap.distance_meters / lap.average_speed, lap.elapsed_time_seconds) : lap.elapsed_time_seconds;
}

// круги серий «по времени»
export function timedLaps(structure: WorkoutData["structure"]) {
  const ids = new Set<number>();
  structure?.segments.forEach((segment) => {
    if (structure.sets[segment.set_index]?.by_time) segment.lap_ids.forEach((id) => ids.add(id));
  });
  return ids;
}

export function buildPaceSummary(laps: WorkoutData["laps"], workLaps: WorkoutData["laps"], structure: WorkoutData["structure"]) {
  // несколько серий — по серии на каждую: «5×800 м — 4:12, 5×200 м — 3:29»
  // у серий без названия (GPS разбросал дистанцию) — просто число рабочих отрезков
  // серии по времени (манеж без GPS) — без темпа: «3×4:11, 4×15 с»
  if (structure && structure.sets.length && structure.sets.every((set) => set.by_time && set.label)) {
    return structure.sets.map((set) => set.label).join(", ");
  }
  if (structure && structure.sets.some((set) => !set.label)) {
    const count = workLaps.length;
    return `${count} ${pluralRu(count, "рабочий отрезок", "рабочих отрезка", "рабочих отрезков")}`;
  }
  if (structure && structure.sets.length > 1) {
    return structure.sets.map((set) => `${set.label} — ${formatPaceSeconds(set.pace_seconds_per_km)}`).join(", ");
  }
  const source = workLaps.length >= 2 ? workLaps : laps.filter((lap) => lap.distance_meters >= 500);
  const paces = source.map((lap) => paceOf(lap.average_speed)).filter((value): value is number => value !== null);
  if (paces.length < 2) return null;
  const range = `${formatPaceSeconds(Math.min(...paces))}–${formatPaceSeconds(Math.max(...paces))}`;
  if (workLaps.length >= 2) {
    const last = paces[paces.length - 1]!;
    const others = paces.slice(0, -1);
    const slowerLast = last > Math.max(...others) + 3;
    return `${paces.length} ${paces.length < 5 ? "отрезка" : "отрезков"} по ${range}${slowerLast ? ", последний — медленнее остальных" : ""}`;
  }
  return `Темп по кругам: ${range} /км`;
}

export function buildHrSummary(zones: HrZoneShare[]) {
  const work = zones[2]!.percent + zones[3]!.percent + zones[4]!.percent;
  const top = zones[4]!.percent;
  if (top >= 30) return `${top}% времени — порог и выше (5 зона)`;
  if (work >= 85) return `Почти всё время — в 3–5 зоне (${work}%)`;
  if (work >= 50) return `Больше половины времени — в 3–5 зоне (${work}%)`;
  if (work >= 15) return `${work}% времени — в 3–5 зоне`;
  return "Спокойно: почти всё время в 1–2 зоне";
}

export function HrZonesBar({ zones, note }: { zones: HrZoneShare[]; note?: string }) {
  return (
    <>
      <div className="ds-zbar" role="img" aria-label={`Время в зонах: ${zones.map((zone) => `${zone.label} — ${zone.percent}%`).join(", ")}`}>
        {zones.map((zone, index) =>
          zone.percent > 0 ? <i key={zone.label} style={{ flex: zone.percent, background: `var(--hrz-${index + 1})` }} /> : null
        )}
      </div>
      <div className="ds-zleg">
        {zones.map((zone, index) => (
          <span key={zone.label}>
            <i style={{ background: `var(--hrz-${index + 1})` }} />
            {zone.label} · {zone.percent}%
          </span>
        ))}
      </div>
      {note ? <p className="ds-zsrc">{note}</p> : null}
    </>
  );
}

// «Подробнее»: всё, что не нужно с первого взгляда, — свёрнуто
function WorkoutDetails({ workout }: { workout: WorkoutData["workout"] }) {
  // часы отдают каденс одной ноги (об/мин) — показываем шаги в минуту
  const cadence = workout.average_cadence ? Math.round(workout.average_cadence < 120 ? workout.average_cadence * 2 : workout.average_cadence) : null;
  const rows = [
    ["Набор высоты", workout.elevation_gain ? `${Math.round(workout.elevation_gain)} м` : null],
    ["Каденс", cadence ? `${cadence} шаг/мин` : null],
    ["Темп с поправкой на рельеф", workout.grade_adjusted_speed ? `${formatPace(workout.grade_adjusted_speed).replace("/км", "")} /км` : null],
    ["Время с остановками", workout.elapsed_time_seconds ? formatDuration(Math.round(workout.elapsed_time_seconds)) : null],
    ["Максимальный пульс", workout.max_heartrate ? `${Math.round(workout.max_heartrate)}` : null],
    ["Калории", workout.calories ? `${Math.round(workout.calories)} ккал` : null],
    ["Часы", workout.device_name ?? null]
  ].filter((row): row is [string, string] => Boolean(row[1]));
  if (!rows.length) return null;
  return (
    <details className="ds-list workout-details">
      <summary className="ds-li">
        <div className="ds-m">
          <b>Подробнее</b>
          <span>{rows.slice(0, 3).map(([label]) => label.toLowerCase()).join(", ")}</span>
        </div>
        <svg className="ds-chev workout-details-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </summary>
      {rows.map(([label, value]) => (
        <div key={label} className="ds-li">
          <div className="ds-m">
            <span style={{ fontSize: 15, color: "var(--ink-2)" }}>{label}</span>
          </div>
          <div className="ds-v" style={{ fontSize: 16 }}>{value}</div>
        </div>
      ))}
    </details>
  );
}

export function WorkoutPage({ mode }: { mode: "trainer" | "athlete" }) {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const sayText = searchParams.get("say") ?? undefined;
  const navigate = useNavigate();
  const showToast = useToast();
  const prefix = mode === "trainer" ? "/api/trainer/workouts/" : "/api/athlete/workouts/";
  const { data, loading, error, refresh } = useApi<WorkoutData>(`${prefix}${params.id}`);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isRaceFormOpen, setIsRaceFormOpen] = useState(false);
  const [lapFilter, setLapFilter] = useState<"all" | "work">("work");
  const [chartCursor, setChartCursor] = useState<number | null>(null);
  const { user } = useAuth();
  const [coachComment, setCoachComment] = useState("");
  const [isSavingComment, setIsSavingComment] = useState(false);
  const [commentStatus, setCommentStatus] = useState<string | null>(null);
  const [isFixingGps, setIsFixingGps] = useState(false);
  const [isUpdatingDistance, setIsUpdatingDistance] = useState(false);
  const [isUpdatingTime, setIsUpdatingTime] = useState(false);
  const [isTrimming, setIsTrimming] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const backHref =
    mode === "trainer" && data?.workout.athlete_id
      ? `/trainer/athletes/${data.workout.athlete_id}`
      : data?.workout.is_owner === false
        ? "/athlete/feed"
        : "/athlete/runs";

  const paceChart = useMemo(
    () => {
      // границы рабочих отрезков в метрах — по индексам точек кругов
      const distance = data?.streams?.distance ?? [];
      const ranges = (data?.structure?.segments ?? [])
        .filter((segment) => segment.start_index !== null && segment.end_index !== null)
        .map((segment) => [distance[segment.start_index!] ?? 0, distance[segment.end_index!] ?? 0] as [number, number])
        .filter(([from, to]) => to > from);
      return preparePaceChart(data?.streams ?? null, data?.workout ?? null, ranges);
    },
    [data]
  );
  const heartRateChart = useMemo(
    () => prepareHeartRateChart(data?.streams ?? null, data?.workout ?? null),
    [data]
  );
  const intervals = useMemo(
    () => buildIntervalBands(data?.streams ?? null, data?.structure ?? null),
    [data]
  );
  const workLapIds = useMemo(
    () => new Set(data?.structure?.work_lap_ids ?? []),
    [data?.structure]
  );
  const timedLapIds = useMemo(() => timedLaps(data?.structure ?? null), [data?.structure]);

  useEffect(() => {
    setCoachComment(data?.workout.coach_comment ?? "");
    setCommentStatus(null);
  }, [data?.workout.coach_comment, data?.workout.id]);

  useEffect(() => {
    if (!isMenuOpen) {
      return undefined;
    }

    function handlePointerDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isMenuOpen]);

  async function handleDelete() {
    if (!data?.workout.id || isDeleting) {
      return;
    }

    const confirmed = window.confirm(
      "Удалить эту тренировку? Лапы и графики тоже будут удалены."
    );
    if (!confirmed) {
      return;
    }

    setIsDeleting(true);
    setIsMenuOpen(false);

    try {
      await api(`${prefix}${data.workout.id}`, { method: "DELETE" });
      forgetApiCache();
      navigate(backHref);
    } catch (deleteError) {
      showToast("error", 
        deleteError instanceof Error ? deleteError.message : "Не удалось удалить тренировку"
      );
      setIsDeleting(false);
    }
  }

  async function handleRename() {
    if (!data?.workout.id || isRenaming) {
      return;
    }

    setIsMenuOpen(false);
    const nextName = window.prompt("Новое название пробежки", data.workout.name);
    if (nextName === null) {
      return;
    }

    const trimmedName = nextName.trim();
    if (!trimmedName) {
      showToast("error", "Название не может быть пустым.");
      return;
    }

    if (trimmedName === data.workout.name) {
      return;
    }

    setIsRenaming(true);

    try {
      await api<{ ok: true; name: string }>(`${prefix}${data.workout.id}/name`, {
        method: "PUT",
        body: JSON.stringify({ name: trimmedName })
      });
      refresh();
    } catch (renameError) {
      showToast("error", 
        renameError instanceof Error ? renameError.message : "Не удалось переименовать тренировку"
      );
    } finally {
      setIsRenaming(false);
    }
  }

  async function handleSaveComment() {
    if (!data?.workout.id || mode !== "trainer" || isSavingComment) {
      return;
    }

    setIsSavingComment(true);
    setCommentStatus(null);

    try {
      const result = await api<{ ok: true; coachComment: string | null }>(
        `/api/trainer/workouts/${data.workout.id}/comment`,
        {
          method: "PUT",
          body: JSON.stringify({ coachComment })
        }
      );
      setCoachComment(result.coachComment ?? "");
      setCommentStatus("Сохранено");
    } catch (saveError) {
      setCommentStatus(
        saveError instanceof Error ? saveError.message : "Не удалось сохранить комментарий"
      );
    } finally {
      setIsSavingComment(false);
    }
  }

  async function handlePreviewAndApplyGpsFix() {
    if (!data?.workout.id || mode !== "trainer" || isFixingGps || isUpdatingDistance) {
      return;
    }

    setIsFixingGps(true);
    setIsMenuOpen(false);

    try {
      const preview = await api<{
        ok: true;
        preview: {
          removedSegments: Array<{ removedDistanceMeters: number; removedTimeSeconds: number }>;
          metadata: {
            mode: "segment_cleanup" | "full_rebuild";
            confidence: "medium" | "high";
            reason: "catastrophic_gps_failure" | "profile_mismatch" | "segment_spikes";
          };
          before: {
            distance_meters: number;
            moving_time_seconds: number;
            average_speed: number | null;
            elevation_gain: number;
          };
          after: {
            distance_meters: number;
            moving_time_seconds: number;
            average_speed: number | null;
            elevation_gain: number;
          };
        };
      }>(`/api/trainer/workouts/${data.workout.id}/gps-fix/preview`, {
        method: "POST"
      });

      const { before, after, removedSegments, metadata } = preview.preview;
      const modeLabel =
        metadata.mode === "full_rebuild"
          ? "Полная реконструкция дистанции"
          : "Локальная очистка GPS-сегментов";
      const reasonLabel =
        metadata.reason === "catastrophic_gps_failure"
          ? "обнаружен сильный сбой GPS"
          : metadata.reason === "profile_mismatch"
            ? "трек конфликтует с профилем спортсмена"
            : "найдены аномальные GPS-скачки";
      const confirmed = window.confirm(
        `${modeLabel}.` +
          `\nПричина: ${reasonLabel}` +
          `\nУверенность: ${metadata.confidence === "high" ? "высокая" : "средняя"}` +
          `\nЗатронуто сегментов: ${removedSegments.length}` +
          `\nДистанция: ${formatDistance(before.distance_meters)} → ${formatDistance(after.distance_meters)}` +
          `\nВремя: ${formatDuration(before.moving_time_seconds)} → ${formatDuration(after.moving_time_seconds)}` +
          `\nТемп: ${formatPace(before.average_speed)} → ${formatPace(after.average_speed)}` +
          `\nНабор: ${Math.round(before.elevation_gain ?? 0)} м → ${Math.round(after.elevation_gain ?? 0)} м` +
          `\n\nПрименить исправление?`
      );

      if (!confirmed) {
        return;
      }

      await api(`/api/trainer/workouts/${data.workout.id}/gps-fix/apply`, {
        method: "POST"
      });
      refresh();
    } catch (fixError) {
      showToast("error", 
        fixError instanceof Error ? fixError.message : "Не удалось исправить GPS-пробежку"
      );
    } finally {
      setIsFixingGps(false);
    }
  }

  async function handlePreviewAndApplyDistanceFix() {
    if (!data?.workout.id || mode !== "trainer" || isFixingGps || isUpdatingDistance || isUpdatingTime || isTrimming) {
      return;
    }

    setIsMenuOpen(false);
    const nextDistance = window.prompt(
      "Новая дистанция пробежки в километрах",
      (data.workout.distance_meters / 1000).toFixed(2)
    );
    if (nextDistance === null) {
      return;
    }

    const parsedDistance = Number(nextDistance.replace(",", "."));
    if (!Number.isFinite(parsedDistance) || parsedDistance <= 0) {
      showToast("error", "Введите корректную дистанцию в километрах.");
      return;
    }

    setIsUpdatingDistance(true);

    try {
      const preview = await api<{
        ok: true;
        preview: {
          before: {
            distance_meters: number;
            moving_time_seconds: number;
            average_speed: number | null;
            elevation_gain: number;
          };
          after: {
            distance_meters: number;
            moving_time_seconds: number;
            average_speed: number | null;
            elevation_gain: number;
          };
          splitCount: number;
        };
      }>(`/api/trainer/workouts/${data.workout.id}/distance-fix/preview`, {
        method: "POST",
        body: JSON.stringify({ distanceKm: parsedDistance })
      });

      const { before, after, splitCount } = preview.preview;
      const confirmed = window.confirm(
        `Дистанция: ${formatDistance(before.distance_meters)} → ${formatDistance(after.distance_meters)}` +
          `\nВремя: ${formatDuration(before.moving_time_seconds)} → ${formatDuration(after.moving_time_seconds)}` +
          `\nТемп: ${formatPace(before.average_speed)} → ${formatPace(after.average_speed)}` +
          `\nОтрезки по 1 км: ${splitCount}` +
          `\n\nПрименить ручную правку дистанции?`
      );

      if (!confirmed) {
        return;
      }

      await api(`/api/trainer/workouts/${data.workout.id}/distance-fix/apply`, {
        method: "POST",
        body: JSON.stringify({ distanceKm: parsedDistance })
      });
      refresh();
    } catch (distanceError) {
      showToast("error", 
        distanceError instanceof Error ? distanceError.message : "Не удалось изменить дистанцию тренировки"
      );
    } finally {
      setIsUpdatingDistance(false);
    }
  }

  function parseDurationInput(value: string) {
    const parts = value.trim().split(":").map((part) => part.trim()).filter(Boolean);
    if (!parts.length || parts.some((part) => !/^\d+$/.test(part))) {
      return null;
    }

    if (parts.length === 1) {
      const minutes = Number(parts[0]);
      return Number.isFinite(minutes) && minutes > 0 ? minutes * 60 : null;
    }

    if (parts.length === 2) {
      const [minutes, seconds] = parts.map(Number);
      if (seconds >= 60) {
        return null;
      }
      return minutes * 60 + seconds;
    }

    if (parts.length === 3) {
      const [hours, minutes, seconds] = parts.map(Number);
      if (minutes >= 60 || seconds >= 60) {
        return null;
      }
      return hours * 3600 + minutes * 60 + seconds;
    }

    return null;
  }

  async function handlePreviewAndApplyTimeFix() {
    if (!data?.workout.id || mode !== "trainer" || isFixingGps || isUpdatingDistance || isUpdatingTime || isTrimming) {
      return;
    }

    setIsMenuOpen(false);
    const nextTime = window.prompt(
      "Новое общее время пробежки в формате мм:сс или чч:мм:сс",
      formatDuration(data.workout.moving_time_seconds)
    );
    if (nextTime === null) {
      return;
    }

    const parsedTimeSeconds = parseDurationInput(nextTime);
    if (!parsedTimeSeconds || parsedTimeSeconds <= 0) {
      showToast("error", "Введите корректное время в формате мм:сс или чч:мм:сс.");
      return;
    }

    setIsUpdatingTime(true);

    try {
      const preview = await api<{
        ok: true;
        preview: {
          before: {
            distance_meters: number;
            moving_time_seconds: number;
            average_speed: number | null;
            elevation_gain: number;
          };
          after: {
            distance_meters: number;
            moving_time_seconds: number;
            average_speed: number | null;
            elevation_gain: number;
          };
          splitCount: number;
        };
      }>(`/api/trainer/workouts/${data.workout.id}/time-fix/preview`, {
        method: "POST",
        body: JSON.stringify({ movingTimeSeconds: parsedTimeSeconds })
      });

      const { before, after, splitCount } = preview.preview;
      const confirmed = window.confirm(
        `Время: ${formatDuration(before.moving_time_seconds)} → ${formatDuration(after.moving_time_seconds)}` +
          `\nТемп: ${formatPace(before.average_speed)} → ${formatPace(after.average_speed)}` +
          `\nДистанция: ${formatDistance(before.distance_meters)} → ${formatDistance(after.distance_meters)}` +
          `\nОтрезки по 1 км: ${splitCount}` +
          `\n\nПрименить ручную правку времени?`
      );

      if (!confirmed) {
        return;
      }

      await api(`/api/trainer/workouts/${data.workout.id}/time-fix/apply`, {
        method: "POST",
        body: JSON.stringify({ movingTimeSeconds: parsedTimeSeconds })
      });
      refresh();
    } catch (timeError) {
      showToast("error", 
        timeError instanceof Error ? timeError.message : "Не удалось изменить общее время тренировки"
      );
    } finally {
      setIsUpdatingTime(false);
    }
  }

  function parseTrimRangeInput(value: string) {
    const match = value.trim().match(/^([\d.,]+)\s*[-–—]\s*([\d.,]+)$/);
    if (!match) {
      return null;
    }

    const startKm = Number(match[1].replace(",", "."));
    const endKm = Number(match[2].replace(",", "."));
    if (!Number.isFinite(startKm) || !Number.isFinite(endKm) || startKm < 0 || endKm <= startKm) {
      return null;
    }

    return { startKm, endKm };
  }

  async function handlePreviewAndApplyTrim() {
    if (!data?.workout.id || mode !== "trainer" || isFixingGps || isUpdatingDistance || isUpdatingTime || isTrimming) {
      return;
    }

    setIsMenuOpen(false);
    const rangeInput = window.prompt(
      "Какой отрезок пробежки оставить, км (от-до).\nВсё до и после будет обрезано.",
      `0-${(data.workout.distance_meters / 1000).toFixed(2)}`
    );
    if (rangeInput === null) {
      return;
    }

    const range = parseTrimRangeInput(rangeInput);
    if (!range) {
      showToast("error", "Введите отрезок в километрах в формате от-до, например 0-8.5.");
      return;
    }

    setIsTrimming(true);

    try {
      const preview = await api<{
        ok: true;
        preview: {
          before: {
            distance_meters: number;
            moving_time_seconds: number;
            average_speed: number | null;
            elevation_gain: number;
          };
          after: {
            distance_meters: number;
            moving_time_seconds: number;
            average_speed: number | null;
            elevation_gain: number;
          };
          splitCount: number;
        };
      }>(`/api/trainer/workouts/${data.workout.id}/trim/preview`, {
        method: "POST",
        body: JSON.stringify(range)
      });

      const { before, after, splitCount } = preview.preview;
      const confirmed = window.confirm(
        `Дистанция: ${formatDistance(before.distance_meters)} → ${formatDistance(after.distance_meters)}` +
          `\nВремя: ${formatDuration(before.moving_time_seconds)} → ${formatDuration(after.moving_time_seconds)}` +
          `\nТемп: ${formatPace(before.average_speed)} → ${formatPace(after.average_speed)}` +
          `\nОтрезки по 1 км: ${splitCount}` +
          `\n\nОбрезать пробежку?`
      );

      if (!confirmed) {
        return;
      }

      await api(`/api/trainer/workouts/${data.workout.id}/trim/apply`, {
        method: "POST",
        body: JSON.stringify(range)
      });
      refresh();
    } catch (trimError) {
      showToast("error",
        trimError instanceof Error ? trimError.message : "Не удалось обрезать пробежку"
      );
    } finally {
      setIsTrimming(false);
    }
  }

  async function handleResetCorrection() {
    if (!data?.workout.id || mode !== "trainer" || isFixingGps || isUpdatingDistance || isUpdatingTime || isTrimming) {
      return;
    }

    const confirmed = window.confirm(
      "Отменить исправление и вернуть исходные данные тренировки?"
    );
    if (!confirmed) {
      return;
    }

    setIsFixingGps(true);
    setIsMenuOpen(false);

    try {
      await api(`/api/trainer/workouts/${data.workout.id}/gps-fix`, {
        method: "DELETE"
      });
      refresh();
    } catch (resetError) {
      showToast("error", 
        resetError instanceof Error ? resetError.message : "Не удалось отменить исправление"
      );
    } finally {
      setIsFixingGps(false);
    }
  }

  if (loading) {
    return (
      <div className="stack">
        <section className="card skeleton-card">
          <p className="muted">Загрузка тренировки...</p>
        </section>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="stack">
        <section className="card">
          <h2>Ошибка</h2>
          <p className="muted">{error || "Тренировка не найдена"}</p>
          <Link to={mode === "trainer" ? "/trainer" : "/athlete"} className="button primary-button">
            На главную
          </Link>
        </section>
      </div>
    );
  }

  const hasSyntheticCorrectedSplits =
    data.workout.gps_fix?.is_corrected &&
    data.workout.gps_fix.kind !== "gps_autofix" &&
    !Array.isArray(data.workout.gps_fix.removed_segments) &&
    data.workout.gps_fix.removed_segments.split_strategy === "synthetic_even";

  // Атлет, открывший тренировку одногруппника из ленты, видит её только на чтение.
  const canEdit = mode === "trainer" || data.workout.is_owner !== false;
  const raceAthleteId = mode === "trainer" ? data.workout.athlete_id : user?.id;

  const workLaps = data.laps.filter((lap) => workLapIds.has(lap.id));
  // отрезки над графиком пронумерованы, как строки таблицы в «Рабочих»
  const bandNumbers =
    intervals.bands.length > 0 && intervals.bands.length <= 12
      ? intervals.bands.map((band, index) => ({ label: String(index + 1), center: `calc(${band.left} + ${band.width} / 2)` }))
      : [];
  const showingWork = Boolean(data.structure && lapFilter === "work" && workLaps.length);
  const visibleLaps = showingWork ? workLaps : data.laps;
  const personalZones = data.hr_zones ?? DEFAULT_HR_ZONES;
  const hrZones = heartRateZones(data.streams, personalZones);
  const paceSummary = buildPaceSummary(data.laps, workLaps, data.structure);
  const hrSummary = hrZones ? buildHrSummary(hrZones) : null;
  const startDate = data.workout.start_date ? new Date(data.workout.start_date) : null;
  const metaParts = [
    mode === "trainer" && data.workout.athlete_name ? data.workout.athlete_name : null,
    startDate ? longWorkoutDate(startDate) : null
  ].filter(Boolean);
  const correctionLabel = data.workout.gps_fix?.is_corrected
    ? data.workout.gps_fix.kind === "manual_distance"
      ? "Дистанция исправлена"
      : data.workout.gps_fix.kind === "manual_time"
        ? "Время исправлено"
        : data.workout.gps_fix.kind === "trim"
          ? "Пробежка обрезана"
          : "GPS исправлено"
    : null;
  const busyAny = isFixingGps || isUpdatingDistance || isUpdatingTime || isTrimming || isRenaming || isDeleting;

  return (
    <div className="ds-screen workout-screen" style={{ gap: 20 }}>
      {/* в Telegram «назад» — нативная кнопка в шапке и свайп (NavGestures); свою не дублируем */}
      {isTelegramMiniApp ? null : (
        <Link
          to={backHref}
          className="ds-link"
          onClick={(event) => {
            // пришли из списка — возвращаемся в историю, чтобы список открылся на том же месте
            if (((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0) {
              event.preventDefault();
              navigate(-1);
            }
          }}
        >
          ‹ {mode === "trainer" ? data.workout.athlete_name ?? "Назад" : canEdit ? "Пробежки" : "Назад"}
        </Link>
      )}

      <div className="workout-th">
        <div style={{ minWidth: 0 }}>
          <h1 className="ds-title" style={{ fontSize: 24 }}>
            {data.workout.name}
          </h1>
          <p className="ds-sub">{metaParts.join(" · ")}</p>
          {correctionLabel ? (
            <div className="workout-tags">
              <span className="ds-pill ds-pill-soft">{correctionLabel}</span>
            </div>
          ) : null}
        </div>
        {canEdit ? (
          <div className="workout-th-actions">
            <ShareStoryButton workoutId={data.workout.id} role={mode} title={data.workout.name} className="ds-icon-btn" iconOnly />
            <div className="workout-menu" ref={menuRef}>
              <button
                type="button"
                className="ds-icon-btn"
                aria-label="Действия"
                aria-expanded={isMenuOpen}
                onClick={() => setIsMenuOpen((open) => !open)}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="5" cy="12" r="1.8" fill="currentColor" />
                  <circle cx="12" cy="12" r="1.8" fill="currentColor" />
                  <circle cx="19" cy="12" r="1.8" fill="currentColor" />
                </svg>
              </button>
              {isMenuOpen ? (
                <div className="workout-menu-popover">
                  <button
                    type="button"
                    className="workout-menu-item"
                    onClick={() => {
                      setIsMenuOpen(false);
                      setIsRaceFormOpen(true);
                    }}
                  >
                    Это был старт
                  </button>
                  {mode === "trainer" ? (
                    <>
                      <button type="button" className="workout-menu-item" disabled={busyAny} onClick={handlePreviewAndApplyGpsFix}>
                        {isFixingGps ? "Обрабатываем..." : "Исправить пробежку"}
                      </button>
                      <button type="button" className="workout-menu-item" disabled={busyAny} onClick={handlePreviewAndApplyDistanceFix}>
                        {isUpdatingDistance ? "Пересчитываем..." : "Изменить дистанцию"}
                      </button>
                      <button type="button" className="workout-menu-item" disabled={busyAny} onClick={handlePreviewAndApplyTimeFix}>
                        {isUpdatingTime ? "Пересчитываем..." : "Изменить время"}
                      </button>
                      <button type="button" className="workout-menu-item" disabled={busyAny} onClick={handlePreviewAndApplyTrim}>
                        {isTrimming ? "Обрезаем..." : "Обрезать пробежку"}
                      </button>
                      {data.workout.gps_fix?.is_corrected ? (
                        <button type="button" className="workout-menu-item" disabled={busyAny} onClick={handleResetCorrection}>
                          Отменить исправление
                        </button>
                      ) : null}
                    </>
                  ) : null}
                  <button type="button" className="workout-menu-item" disabled={busyAny} onClick={handleRename}>
                    {isRenaming ? "Переименовываем..." : "Переименовать пробежку"}
                  </button>
                  <button type="button" className="workout-menu-item workout-menu-item-danger" disabled={busyAny} onClick={handleDelete}>
                    {isDeleting ? "Удаляем..." : "Удалить тренировку"}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {/* главное число — дистанция, под ним время · темп · пульс (client/DESIGN.md: одно крупное число) */}
      <div className="workout-stats">
        <div className="ds-big">
          {formatKmShort(data.workout.distance_meters)}
          <small>км</small>
        </div>
        <div className="workout-stats-row">
          <div>
            <span>время</span>
            <b>{formatDuration(Math.round(data.workout.moving_time_seconds))}</b>
          </div>
          <div>
            <span>темп /км</span>
            <b>{formatPace(data.workout.average_speed).replace("/км", "")}</b>
          </div>
          <div>
            <span>пульс</span>
            <b>{data.workout.average_heartrate ? Math.round(data.workout.average_heartrate) : "—"}</b>
          </div>
        </div>
      </div>

      {/* одна переписка спортсмена и тренера (комментарий тренера — его сообщение); одногруппники не видят */}
      {mode === "trainer" || canEdit ? (
        <section className="ds-block workout-coach chat-card" aria-label="Переписка с тренером">
          <CoachChat
            workoutId={data.workout.id}
            viewer={mode}
            title={mode === "trainer" ? (data.workout.athlete_name ?? "Спортсмен").split(" ")[0]! : (data.coach?.full_name ?? "Тренер")}
            peerAvatarUrl={mode === "trainer" ? null : (data.coach?.avatar_url ?? null)}
            placeholder={mode === "trainer" ? "Сообщение спортсмену…" : "Сообщение тренеру…"}
            emptyText={mode === "trainer" ? undefined : "Тренер посмотрит пробежку и ответит здесь."}
          />
        </section>
      ) : null}


      {mode === "trainer" || canEdit ? (
        <WorkoutFeeling workoutId={data.workout.id} feeling={data.feeling} editable={mode === "athlete" && canEdit} />
      ) : null}

      {data.streams?.latlng?.length ? (
        <div className="ds-block workout-map">
          <Suspense
            fallback={
              <div className="workout-route-loading skeleton-card" aria-hidden="true">
                <div className="workout-route-loading-grid" />
              </div>
            }
          >
            <WorkoutRouteMap points={data.streams.latlng} />
          </Suspense>
        </div>
      ) : null}

      <section className="ds-block ds-pad" aria-label="Отрезки">
        <div className="workout-laps-head">
          <b style={{ fontSize: 16 }}>Отрезки</b>
          {data.structure && workLaps.length ? (
            <div className="ds-seg" role="group" aria-label="Какие отрезки показать">
              <button type="button" aria-pressed={lapFilter === "all"} onClick={() => setLapFilter("all")}>
                Все
              </button>
              <button type="button" aria-pressed={lapFilter === "work"} onClick={() => setLapFilter("work")}>
                Рабочие
              </button>
            </div>
          ) : null}
        </div>
        {hasSyntheticCorrectedSplits ? (
          <p className="ds-sub">Сплиты восстановлены приближённо по исправленной сводке тренировки.</p>
        ) : null}
        {visibleLaps.length ? (
          <table className="ds-laps" aria-label="Отрезки">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Км</th>
                <th scope="col">Время</th>
                <th scope="col">Темп</th>
                <th scope="col">Пульс</th>
                <th scope="col" title="Разница высоты от начала до конца круга">Высота</th>
              </tr>
            </thead>
            <tbody>
              {visibleLaps.map((lap, index) => (
                <tr key={lap.id} className={workLapIds.has(lap.id) ? "is-work" : undefined}>
                  {/* в «Рабочих» отрезки нумеруются подряд, как подписи над графиком */}
                  <td>{index + 1}</td>
                  <td>{formatLapDistanceKilometers(lap.distance_meters).replace(".", ",")}</td>
                  <td>
                    {/* серия по времени (манеж без GPS) — выделяем время движения отрезка, а не темп */}
                    {timedLapIds.has(lap.id) ? (
                      <span className="lap-pace">{formatLapTime(lapMovingSeconds(lap))}</span>
                    ) : (
                      formatLapTime(lap.elapsed_time_seconds)
                    )}
                  </td>
                  <td>
                    {/* темп рабочего отрезка — плашкой цвета темпа, как полосы на графике */}
                    {/* без интервалов выделяем темп всех кругов, с интервалами — только рабочих */}
                    {!timedLapIds.has(lap.id) && ((!data.structure && lap.distance_meters >= 100) || workLapIds.has(lap.id)) ? (
                      <span className="lap-pace">{formatPace(lap.average_speed).replace("/км", "")}</span>
                    ) : (
                      formatPace(lap.average_speed).replace("/км", "")
                    )}
                  </td>
                  <td>{lap.average_heartrate ? Math.round(lap.average_heartrate) : "—"}</td>
                  <td className="lap-elev">{formatLapElevation(lap.elevation_gain)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="ds-sub">У этой тренировки нет отдельных отрезков.</p>
        )}
      </section>

      <section className="ds-block ds-pad" aria-label="Темп">
        <StreamChart
          title="Темп"
          model={paceChart}
          color="var(--chart-pace)"
          formatter={formatPaceSeconds}
          bands={intervals.bands}
          bandLabels={bandNumbers.length ? bandNumbers : intervals.labels}
          summary={paceSummary}
          refValue={data.workout.average_speed ? 1000 / data.workout.average_speed : null}
          unit=" /км"
          cursor={chartCursor}
          onCursor={setChartCursor}
        />
      </section>
      <section className="ds-block ds-pad" aria-label="Пульс">
        <StreamChart
          title="Пульс"
          model={heartRateChart}
          color="var(--chart-hr)"
          formatter={(value) => `${Math.round(value)}`}
          summary={hrSummary}
          unit=" уд/мин"
          cursor={chartCursor}
          onCursor={setChartCursor}
          zones={[
            { from: personalZones.bounds[0], to: personalZones.bounds[1], color: "var(--hrz-2-bg)" },
            { from: personalZones.bounds[1], to: personalZones.bounds[2], color: "var(--hrz-3-bg)" },
            { from: personalZones.bounds[2], to: personalZones.bounds[3], color: "var(--hrz-4-bg)" },
            { from: personalZones.bounds[3], to: 240, color: "var(--hrz-5-bg)" }
          ]}
          footer={hrZones ? <HrZonesBar zones={hrZones} note={zonesSourceNote(personalZones)} /> : null}
        />
      </section>

      {/* общие комментарии клуба: поздравления, поддержка одногруппников */}


      <WorkoutDetails workout={data.workout} />

      {isRaceFormOpen && raceAthleteId ? (
        <ResultForm
          athleteId={raceAthleteId}
          draft={{
            status: "finished",
            name: data.workout.name,
            raceDate: (data.workout.start_date ?? "").slice(0, 10),
            distanceMeters: data.workout.distance_meters,
            officialTimeSeconds: data.workout.moving_time_seconds,
            workoutId: data.workout.id,
            watchDistanceMeters: data.workout.distance_meters
          }}
          onClose={() => setIsRaceFormOpen(false)}
          onSaved={() => setIsRaceFormOpen(false)}
        />
      ) : null}
    </div>
  );
}
