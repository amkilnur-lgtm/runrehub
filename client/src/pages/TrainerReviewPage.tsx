import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../api";
import { useToast } from "../components/ToastProvider";
import { ReviewChart } from "../components/ReviewChart";
import { UserAvatar } from "../components/UserAvatar";
import { forgetApiCache, useApi } from "../hooks/useApi";
import { formatDuration, formatKm, formatPace } from "../lib";
import type { WorkoutData } from "../types/workout";
import {
  buildHrSummary,
  buildPaceSummary,
  heartRateZones,
  HrZonesBar,
} from "./WorkoutPage";

// «Разбор»: пробежки этой недели без комментария — по одной, от старых к новым.
// Главное действие одно: «Отправить и дальше».

const EFFORT_LABEL = {
  easy: "легко",
  normal: "нормально",
  hard: "тяжело",
} as const;
const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

function whenLabel(iso: string) {
  const date = new Date(iso);
  const time = date.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const today = new Date();
  const days = Math.floor(
    (new Date(today.toDateString()).getTime() -
      new Date(date.toDateString()).getTime()) /
      86_400_000,
  );
  if (days === 0) return `сегодня, ${time}`;
  if (days === 1) return `вчера, ${time}`;
  return `${WEEKDAYS[date.getDay()]}, ${time}`;
}

export function TrainerReviewPage() {
  const showToast = useToast();
  // очередь фиксируем на время разбора: отправленные уходят, порядок не прыгает
  // круги свёрнуты: главный график уже показывает отрезки
  const [lapsOpen, setLapsOpen] = useState(false);
  const [queue, setQueue] = useState<number[] | null>(null);
  // ответы спортсменов в обсуждении: на них тренер отвечает в то же обсуждение
  const [replies, setReplies] = useState<Map<number, string>>(new Map());
  const [index, setIndex] = useState(0);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    api<{
      workoutIds: number[];
      replies: { workoutId: number; body: string }[];
    }>("/api/trainer/review-queue")
      .then((res) => {
        setReplies(
          new Map(res.replies.map((reply) => [reply.workoutId, reply.body])),
        );
        setQueue(res.workoutIds);
      })
      .catch(() => setQueue([]));
  }, []);

  const currentId = queue && index < queue.length ? queue[index]! : null;
  const { data } = useApi<WorkoutData & { feeling?: WorkoutData["feeling"] }>(
    currentId ? `/api/trainer/workouts/${currentId}` : null,
  );
  const workout = data && data.workout.id === currentId ? data : null;

  const athleteReply = currentId ? (replies.get(currentId) ?? null) : null;

  useEffect(() => {
    setLapsOpen(false);
    setComment(athleteReply ? "" : (workout?.workout.coach_comment ?? ""));
  }, [workout?.workout.id]);

  async function send() {
    if (!currentId || !comment.trim() || sending) return;
    setSending(true);
    try {
      if (athleteReply) {
        // ответ на сообщение спортсмена — в обсуждение пробежки
        await api(`/api/trainer/workouts/${currentId}/comments`, {
          method: "POST",
          body: JSON.stringify({ body: comment.trim(), channel: "coach" }),
        });
      } else {
        await api(`/api/trainer/workouts/${currentId}/comment`, {
          method: "PUT",
          body: JSON.stringify({ coachComment: comment.trim() }),
        });
      }
      forgetApiCache("/api/trainer");
      setIndex((value) => value + 1);
    } catch (err) {
      showToast(
        "error",
        err instanceof Error ? err.message : "Не удалось отправить",
      );
    } finally {
      setSending(false);
    }
  }

  if (queue === null) {
    return (
      <div className="ds-screen">
        <div className="skeleton-block" style={{ height: 32, width: 200 }} />
        <div
          className="skeleton-block"
          style={{ height: 260, borderRadius: 16 }}
        />
      </div>
    );
  }

  if (!currentId) {
    return (
      <div className="ds-screen">
        <h1 className="ds-title">Разбор</h1>
        <section className="ds-block ds-pad">
          <b style={{ fontSize: 17 }}>
            {queue.length ? "Всё разобрано" : "Разбирать нечего"}
          </b>
          <p className="ds-sub">
            {queue.length
              ? `Комментарии к ${queue.length} ${queue.length === 1 ? "пробежке" : "пробежкам"} отправлены.`
              : "Все пробежки этой недели уже с комментарием."}
          </p>
          <Link
            className="ds-btn ds-btn-2"
            style={{ marginTop: 14 }}
            to="/trainer"
          >
            К группе
          </Link>
        </section>
      </div>
    );
  }

  const name = workout?.workout.athlete_name ?? "";
  const firstName = name.split(" ")[0] ?? "";
  const workIds = new Set(workout?.structure?.work_lap_ids ?? []);
  const workLaps = (workout?.laps ?? []).filter((lap) => workIds.has(lap.id));
  // у интервалов — рабочие отрезки, у ровной пробежки — все круги (без огрызков)
  const lapRows = workLaps.length
    ? workLaps
    : (workout?.laps ?? []).filter((lap) => lap.distance_meters >= 100);
  const hrZones = workout ? heartRateZones(workout.streams) : null;
  const paceSummary = workout
    ? buildPaceSummary(workout.laps, workLaps, workout.structure)
    : null;
  const hrSummary = hrZones ? buildHrSummary(hrZones) : null;
  const feeling = workout?.feeling;
  const isLast = index === queue.length - 1;

  return (
    <div className="ds-screen review-screen" style={{ gap: 18 }}>
      <div>
        <div className="review-top">
          <span>
            Разбор · {index + 1} из {queue.length}
          </span>
          <button
            type="button"
            className="ds-btn ds-btn-3"
            style={{ height: 36 }}
            onClick={() => setIndex((value) => value + 1)}
          >
            Пропустить
          </button>
        </div>
        <div className="review-prog" aria-hidden="true">
          {queue.map((id, position) => (
            <i key={id} className={position <= index ? "is-done" : undefined} />
          ))}
        </div>
      </div>

      {!workout ? (
        <div
          className="skeleton-block"
          style={{ height: 240, borderRadius: 16 }}
        />
      ) : (
        <>
          <div className="review-who">
            <UserAvatar
              fullName={name}
              avatarUrl={null}
              className="avatar-sm review-avatar"
            />
            <div style={{ minWidth: 0 }}>
              <h1 className="ds-title" style={{ fontSize: 22 }}>
                {firstName} · {workout.workout.name}
              </h1>
              <p className="ds-sub" style={{ marginTop: 2 }}>
                {whenLabel(workout.workout.start_date)} ·{" "}
                <Link
                  className="ds-link"
                  style={{ fontSize: 14.5 }}
                  to={`/trainer/workouts/${currentId}`}
                >
                  весь разбор ›
                </Link>
              </p>
            </div>
          </div>

          <div className="workout-stats">
            <div className="ds-big">
              {formatKm(workout.workout.distance_meters, 2)}
              <small>км</small>
            </div>
            <div className="workout-stats-row">
              <div>
                <span>время</span>
                <b>
                  {formatDuration(
                    Math.round(workout.workout.moving_time_seconds),
                  )}
                </b>
              </div>
              <div>
                <span>темп /км</span>
                <b>
                  {formatPace(workout.workout.average_speed).replace("/км", "")}
                </b>
              </div>
              <div>
                <span>пульс</span>
                <b>
                  {workout.workout.average_heartrate
                    ? Math.round(workout.workout.average_heartrate)
                    : "—"}
                </b>
              </div>
            </div>
          </div>

          {feeling?.effort || feeling?.pain ? (
            <section
              className="ds-block ds-pad"
              aria-label="Самочувствие спортсмена"
            >
              <div className="feel-row" style={{ marginTop: 0 }}>
                {feeling.effort ? (
                  <span
                    className={`ds-pill ${feeling.effort === "hard" ? "ds-pill-warn" : "ds-pill-good"}`}
                  >
                    Ощущалось: {EFFORT_LABEL[feeling.effort]}
                  </span>
                ) : null}
                {feeling.pain === "light" ? (
                  <span className="ds-pill ds-pill-warn">Лёгкая боль</span>
                ) : null}
                {feeling.pain === "none" ? (
                  <span className="ds-pill ds-pill-good">Ничего не болит</span>
                ) : null}
              </div>
            </section>
          ) : null}

          {athleteReply ? (
            <section
              className="ds-block ds-pad review-reply"
              aria-label="Сообщение спортсмена"
            >
              <span className="ds-pill ds-pill-accent">
                {firstName} ответил(а)
              </span>
              <p>«{athleteReply}»</p>
              {workout.workout.coach_comment?.trim() ? (
                <p className="review-prev">
                  Ваш комментарий: {workout.workout.coach_comment.trim()}
                </p>
              ) : null}
            </section>
          ) : null}

          {/* главный график по типу пробежки — сразу под самочувствием */}
          <ReviewChart workout={workout} workLaps={workLaps} />

          {paceSummary || hrSummary || hrZones ? (
            <section
              className="ds-block ds-pad review-how"
              aria-label="Как прошла"
            >
              {paceSummary ? (
                <p>
                  <b>Темп</b> {paceSummary}
                </p>
              ) : null}
              {hrSummary ? (
                <p>
                  <b>Пульс</b> {hrSummary}
                </p>
              ) : null}
              {hrZones ? <HrZonesBar zones={hrZones} /> : null}
            </section>
          ) : null}

          {lapRows.length ? (
            <section
              className="ds-block ds-pad"
              aria-label={workLaps.length ? "Рабочие отрезки" : "Круги"}
            >
              <button
                type="button"
                className="cy-toggle"
                aria-expanded={lapsOpen}
                onClick={() => setLapsOpen((value) => !value)}
              >
                <b>
                  {workLaps.length ? "Рабочие отрезки" : "Круги"} ·{" "}
                  {lapRows.length}
                </b>
                <span>{lapsOpen ? "свернуть" : "развернуть"}</span>
                <i className="cy-chev" aria-hidden="true" />
              </button>
              {lapsOpen ? (
                <table className="ds-laps" style={{ marginTop: 6 }}>
                  <thead>
                    <tr>
                      <th scope="col">#</th>
                      <th scope="col">Км</th>
                      <th scope="col">Темп</th>
                      <th scope="col">Пульс</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lapRows.map((lap, position) => (
                      <tr key={lap.id} className="is-work">
                        <td>{position + 1}</td>
                        <td>
                          {(lap.distance_meters / 1000)
                            .toFixed(2)
                            .replace(".", ",")}
                        </td>
                        <td>
                          <span className="lap-pace">
                            {formatPace(lap.average_speed).replace("/км", "")}
                          </span>
                        </td>
                        <td>
                          {lap.average_heartrate
                            ? Math.round(lap.average_heartrate)
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </section>
          ) : null}

          <label className="review-comment">
            <span>
              {athleteReply
                ? "Ваш ответ — в обсуждение пробежки"
                : "Комментарий для спортсмена"}
            </span>
            <textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="Что получилось, что поправить в следующий раз"
              rows={5}
            />
          </label>
        </>
      )}

      <div className="review-bar">
        <button
          type="button"
          className="ds-btn ds-btn-1 ds-btn-full"
          disabled={!workout || !comment.trim() || sending}
          onClick={() => void send()}
        >
          {sending
            ? "Отправляем…"
            : isLast
              ? "Отправить"
              : "Отправить и дальше"}
        </button>
      </div>
    </div>
  );
}
