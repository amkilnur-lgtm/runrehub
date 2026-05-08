import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { api } from "../api";
import { StreamChart } from "../components/StreamChart";
import { formatHeartRate, prepareHeartRateChart } from "../chart/heartrate-chart";
import { formatPaceSeconds, preparePaceChart } from "../chart/pace-chart";
import { useApi } from "../hooks/useApi";
import { formatDate, formatDistance, formatDuration, formatPace } from "../lib";
import { WorkoutData } from "../types/workout";

const WorkoutRouteMap = lazy(async () =>
  import("../components/WorkoutRouteMap").then((module) => ({ default: module.WorkoutRouteMap }))
);

function formatLapElevation(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }

  const rounded = Math.round(value);
  if (rounded === 0) {
    return "0";
  }

  return `${rounded}`;
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

export function WorkoutPage({ mode }: { mode: "trainer" | "athlete" }) {
  const params = useParams();
  const navigate = useNavigate();
  const prefix = mode === "trainer" ? "/api/trainer/workouts/" : "/api/athlete/workouts/";
  const { data, loading, error, refresh } = useApi<WorkoutData>(`${prefix}${params.id}`);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [coachComment, setCoachComment] = useState("");
  const [isSavingComment, setIsSavingComment] = useState(false);
  const [commentStatus, setCommentStatus] = useState<string | null>(null);
  const [isFixingGps, setIsFixingGps] = useState(false);
  const [isUpdatingDistance, setIsUpdatingDistance] = useState(false);
  const [isUpdatingTime, setIsUpdatingTime] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const backHref =
    mode === "trainer" && data?.workout.athlete_id
      ? `/trainer/athletes/${data.workout.athlete_id}`
      : "/athlete";

  const paceChart = useMemo(
    () => preparePaceChart(data?.streams ?? null, data?.workout ?? null),
    [data]
  );
  const heartRateChart = useMemo(
    () => prepareHeartRateChart(data?.streams ?? null, data?.workout ?? null),
    [data]
  );

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
      navigate(backHref);
    } catch (deleteError) {
      window.alert(
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
      window.alert("Название не может быть пустым.");
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
      window.alert(
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
      window.alert(
        fixError instanceof Error ? fixError.message : "Не удалось исправить GPS-пробежку"
      );
    } finally {
      setIsFixingGps(false);
    }
  }

  async function handlePreviewAndApplyDistanceFix() {
    if (!data?.workout.id || mode !== "trainer" || isFixingGps || isUpdatingDistance || isUpdatingTime) {
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
      window.alert("Введите корректную дистанцию в километрах.");
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
      window.alert(
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
    if (!data?.workout.id || mode !== "trainer" || isFixingGps || isUpdatingDistance || isUpdatingTime) {
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
      window.alert("Введите корректное время в формате мм:сс или чч:мм:сс.");
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
      window.alert(
        timeError instanceof Error ? timeError.message : "Не удалось изменить общее время тренировки"
      );
    } finally {
      setIsUpdatingTime(false);
    }
  }

  async function handleResetCorrection() {
    if (!data?.workout.id || mode !== "trainer" || isFixingGps || isUpdatingDistance || isUpdatingTime) {
      return;
    }

    const confirmed = window.confirm(
      "Отменить исправление и вернуть исходные данные Strava?"
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
      window.alert(
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

  return (
    <div className="stack">
      <Link to={backHref} className="inline-link workout-back-link">
        Назад
      </Link>

      <section
        className={`card workout-summary-card${data.streams?.latlng?.length ? " workout-summary-card-with-route" : ""}`}
      >
        <div className="workout-summary-panel">
          <div className="workout-summary-header">
            <div className="workout-summary-topbar">
              <span className="muted trainer-dashboard-eyebrow">СВОДКА</span>
              <div className="workout-menu" ref={menuRef}>
                <button
                  type="button"
                  className="ghost-button workout-menu-trigger"
                  aria-label="Действия"
                  aria-expanded={isMenuOpen}
                  onClick={() => setIsMenuOpen((open) => !open)}
                >
                  <svg
                    className="workout-menu-icon"
                    viewBox="0 0 4 18"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <circle cx="2" cy="2" r="1.25" />
                    <circle cx="2" cy="9" r="1.25" />
                    <circle cx="2" cy="16" r="1.25" />
                  </svg>
                </button>
                {isMenuOpen ? (
                  <div className="workout-menu-popover">
                    {mode === "trainer" ? (
                      <>
                        <button
                          type="button"
                          className="workout-menu-item"
                          disabled={isFixingGps || isUpdatingDistance || isUpdatingTime || isRenaming || isDeleting}
                          onClick={handlePreviewAndApplyGpsFix}
                        >
                          {isFixingGps ? "Обрабатываем..." : "Исправить пробежку"}
                        </button>
                        <button
                          type="button"
                          className="workout-menu-item"
                          disabled={isUpdatingDistance || isFixingGps || isUpdatingTime || isRenaming || isDeleting}
                          onClick={handlePreviewAndApplyDistanceFix}
                        >
                          {isUpdatingDistance ? "Пересчитываем..." : "Изменить дистанцию"}
                        </button>
                        <button
                          type="button"
                          className="workout-menu-item"
                          disabled={isUpdatingTime || isFixingGps || isUpdatingDistance || isRenaming || isDeleting}
                          onClick={handlePreviewAndApplyTimeFix}
                        >
                          {isUpdatingTime ? "Пересчитываем..." : "Изменить время"}
                        </button>
                        {data.workout.gps_fix?.is_corrected ? (
                          <button
                            type="button"
                            className="workout-menu-item"
                            disabled={isFixingGps || isUpdatingDistance || isUpdatingTime || isRenaming || isDeleting}
                            onClick={handleResetCorrection}
                          >
                            Отменить исправление
                          </button>
                        ) : null}
                      </>
                    ) : null}
                    <button
                      type="button"
                      className="workout-menu-item"
                      disabled={isRenaming || isDeleting || isFixingGps || isUpdatingDistance || isUpdatingTime}
                      onClick={handleRename}
                    >
                      {isRenaming ? "Переименовываем..." : "Переименовать пробежку"}
                    </button>
                    <button
                      type="button"
                      className="workout-menu-item workout-menu-item-danger"
                      disabled={isDeleting || isRenaming || isFixingGps || isUpdatingDistance || isUpdatingTime}
                      onClick={handleDelete}
                    >
                      {isDeleting ? "Удаляем..." : "Удалить тренировку"}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="trainer-dashboard-heading workout-summary-heading">
              <h2>{data.workout.name}</h2>
              <p className="muted">
                {mode === "trainer" && data.workout.athlete_name ? `${data.workout.athlete_name} · ` : ""}
                {data.workout.start_date ? formatDate(data.workout.start_date) : ""}
              </p>
              {data.workout.gps_fix?.is_corrected ? (
                <span className="muted workout-gps-fix-badge">
                  {data.workout.gps_fix.kind === "manual_distance"
                    ? "Дистанция исправлена"
                    : data.workout.gps_fix.kind === "manual_time"
                      ? "Время исправлено"
                      : "GPS исправлено"}
                </span>
              ) : null}
            </div>
          </div>

          <div className="workout-summary-stats">
            <div className="workout-summary-stat">
              <span className="muted">Километраж</span>
              <strong>{formatDistance(data.workout.distance_meters)}</strong>
            </div>
            <div className="workout-summary-stat">
              <span className="muted">Общее время</span>
              <strong>{formatDuration(data.workout.moving_time_seconds)}</strong>
            </div>
            <div className="workout-summary-stat">
              <span className="muted">Средний темп</span>
              <strong>{formatPace(data.workout.average_speed)}</strong>
            </div>
            <div className="workout-summary-stat">
              <span className="muted">Средний пульс</span>
              <strong>{formatHeartRate(data.workout.average_heartrate)}</strong>
            </div>
            <div className="workout-summary-stat">
              <span className="muted">Набор высоты</span>
              <strong>{`${Math.round(data.workout.elevation_gain ?? 0)} м`}</strong>
            </div>
            <div className="workout-summary-stat workout-summary-stat-placeholder" aria-hidden="true" />
          </div>
        </div>

        {data.streams?.latlng?.length ? (
          <div className="workout-route-shell">
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
      </section>

      <section className="grid workout-layout">
        <div className="card">
          <h2>Отрезки</h2>
          {hasSyntheticCorrectedSplits ? (
            <p className="muted">Сплиты восстановлены приближённо по исправленной сводке тренировки.</p>
          ) : null}
          {data.laps.length ? (
            <div className="lap-report-wrap">
              <table className="lap-report-table" aria-label="Статистика по кругам">
                <colgroup>
                  <col className="lap-col-lap" />
                  <col className="lap-col-distance" />
                  <col className="lap-col-time" />
                  <col className="lap-col-pace" />
                  <col className="lap-col-heart" />
                  <col className="lap-col-elevation" />
                </colgroup>
                <thead>
                  <tr className="lap-report-head muted">
                    <th scope="col">КРУГ</th>
                    <th scope="col">КМ</th>
                    <th scope="col">ВР</th>
                    <th scope="col">ТЕМП</th>
                    <th scope="col">ЧСС</th>
                    <th scope="col">М</th>
                  </tr>
                </thead>
                <tbody>
                  {data.laps.map((lap, index) => (
                    <tr key={lap.id} className="lap-report-row">
                      <td className="lap-report-index">{index + 1}</td>
                      <td className="lap-report-distance">{formatLapDistanceKilometers(lap.distance_meters)}</td>
                      <td className="lap-report-time">{formatLapTime(lap.elapsed_time_seconds)}</td>
                      <td className="lap-report-pace-cell">
                        <span className="lap-report-pace-pill">{formatPace(lap.average_speed)}</span>
                      </td>
                      <td className="lap-report-heart">
                        <span className="lap-report-heart-icon" aria-hidden="true">
                          ♥
                        </span>
                        <span className="lap-report-heart-value">
                          {lap.average_heartrate ? Math.round(lap.average_heartrate) : "—"}
                        </span>
                      </td>
                      <td className="lap-report-elevation">{formatLapElevation(lap.elevation_gain)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="muted">Strava не вернула отдельные отрезки для этой тренировки.</div>
          )}
        </div>

        <div className="chart-column">
          <StreamChart
            title="Темп"
            model={paceChart}
            color="#2476e5"
            formatter={formatPaceSeconds}
          />
          <StreamChart
            title="Пульс"
            model={heartRateChart}
            color="#d53a3a"
            formatter={(value) => `${Math.round(value)}`}
          />
          <section className="card workout-comment-card">
            <div className="chart-title-row">
              <strong>Комментарий тренера</strong>
            </div>
            {mode === "trainer" ? (
              <div className="stack">
                <label className="workout-comment-field">
                  <textarea
                    value={coachComment}
                    onChange={(event) => setCoachComment(event.target.value)}
                    placeholder="Добавь комментарий к тренировке"
                    rows={5}
                  />
                </label>
                <div className="workout-comment-actions">
                  <button
                    type="button"
                    className="primary-button"
                    disabled={isSavingComment}
                    onClick={handleSaveComment}
                  >
                    {isSavingComment ? "Сохраняем..." : "Сохранить"}
                  </button>
                  {commentStatus ? <span className="muted">{commentStatus}</span> : null}
                </div>
              </div>
            ) : (
              <div className="workout-comment-text">
                {data.workout.coach_comment?.trim() ||
                  "Тренер пока не оставил комментарий к этой тренировке."}
              </div>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}
