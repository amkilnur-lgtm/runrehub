import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { api } from "../api";
import { StreamChart } from "../components/StreamChart";
import { formatHeartRate, prepareHeartRateChart } from "../chart/heartrate-chart";
import { formatPaceSeconds, preparePaceChart } from "../chart/pace-chart";
import { useApi } from "../hooks/useApi";
import { formatDate, formatDistance, formatDuration, formatPace } from "../lib";
import { WorkoutData } from "../types/workout";

function formatElevation(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }

  const rounded = Math.round(value);
  if (rounded === 0) {
    return "0";
  }

  return `${rounded}`;
}

export function WorkoutPage({ mode }: { mode: "trainer" | "athlete" }) {
  const params = useParams();
  const navigate = useNavigate();
  const prefix = mode === "trainer" ? "/api/trainer/workouts/" : "/api/athlete/workouts/";
  const { data, loading, error } = useApi<WorkoutData>(`${prefix}${params.id}`);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [coachComment, setCoachComment] = useState("");
  const [isSavingComment, setIsSavingComment] = useState(false);
  const [commentStatus, setCommentStatus] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const backHref =
    mode === "trainer" && data?.workout.athlete_id
      ? `/trainer/athletes/${data.workout.athlete_id}`
      : "/athlete";

  async function handleDelete() {
    if (!data?.workout.id || isDeleting) {
      return;
    }

    const confirmed = window.confirm("Удалить эту тренировку? Лапы и графики тоже будут удалены.");
    if (!confirmed) {
      return;
    }

    setIsDeleting(true);
    setIsMenuOpen(false);
    try {
      await api(`${prefix}${data.workout.id}`, { method: "DELETE" });
      navigate(backHref);
    } catch (deleteError) {
      window.alert(deleteError instanceof Error ? deleteError.message : "Не удалось удалить тренировку");
      setIsDeleting(false);
    }
  }

  const paceChart = useMemo(() => preparePaceChart(data?.streams ?? null, data?.workout ?? null), [data]);
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
      setCommentStatus(saveError instanceof Error ? saveError.message : "Не удалось сохранить комментарий");
    } finally {
      setIsSavingComment(false);
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

  return (
    <div className="stack">
      <section className="card">
        <div className="section-header workout-header">
          <Link to={backHref} className="inline-link">
            Назад
          </Link>
          <div className="workout-menu" ref={menuRef}>
            <button
              type="button"
              className="ghost-button workout-menu-trigger"
              aria-label="Действия"
              aria-expanded={isMenuOpen}
              onClick={() => setIsMenuOpen((open) => !open)}
            >
              ...
            </button>
            {isMenuOpen ? (
              <div className="workout-menu-popover">
                <button
                  type="button"
                  className="workout-menu-item"
                  disabled={isDeleting}
                  onClick={handleDelete}
                >
                  {isDeleting ? "Удаляем..." : "Удалить тренировку"}
                </button>
              </div>
            ) : null}
          </div>
        </div>
        <h2>{data.workout.name}</h2>
        <p className="muted">
          {mode === "trainer" && data.workout.athlete_name ? `${data.workout.athlete_name} · ` : ""}
          {data.workout.start_date ? formatDate(data.workout.start_date) : ""}
        </p>
        <div className="grid workout-stats-grid">
          <div className="card inset-card">
            <div className="muted">Километраж</div>
            <div className="stat-value">{formatDistance(data.workout.distance_meters)}</div>
          </div>
          <div className="card inset-card">
            <div className="muted">Общее время</div>
            <div className="stat-value">{formatDuration(data.workout.moving_time_seconds)}</div>
          </div>
          <div className="card inset-card">
            <div className="muted">Средний темп</div>
            <div className="stat-value">{formatPace(data.workout.average_speed)}</div>
          </div>
          <div className="card inset-card">
            <div className="muted">Средний пульс</div>
            <div className="stat-value">{formatHeartRate(data.workout.average_heartrate)}</div>
          </div>
          <div className="card inset-card">
            <div className="muted">Набор высоты</div>
            <div className="stat-value">{`${Math.round(data.workout.elevation_gain ?? 0)} м`}</div>
          </div>
        </div>
      </section>

      <section className="grid workout-layout">
        <div className="card">
          <h2>Отрезки</h2>
          {data.laps.length ? (
            <div className="compact-laps">
              <div className="compact-laps-head muted">
                <span>Отрезок</span>
                <span>Км</span>
                <span>Темп</span>
                <span title="Пульс">♥</span>
                <span title="Набор/сброс">↕</span>
              </div>
              {data.laps.map((lap, index) => (
                <div key={lap.id} className="compact-lap-row">
                  <span className="lap-name" data-label="Lap">
                    {lap.name || `Lap ${index + 1}`}
                  </span>
                  <span data-label="Км">{formatDistance(lap.distance_meters)}</span>
                  <span data-label="Темп">{formatPace(lap.average_speed)}</span>
                  <span>{lap.average_heartrate ? `${Math.round(lap.average_heartrate)}` : "—"}</span>
                  <span data-label="Высота">{formatElevation(lap.elevation_gain)}</span>
                </div>
              ))}
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
                {data.workout.coach_comment?.trim() || "Тренер пока не оставил комментарий к этой тренировке."}
              </div>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}
