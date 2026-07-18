import { useEffect, useState } from "react";

import { api } from "../api";
import { useToast } from "./ToastProvider";
import { UserAvatar } from "./UserAvatar";
import { formatAgo } from "../lib";

export type WorkoutCommentItem = {
  id: number;
  body: string;
  created_at: string;
  author_id: number;
  author_name: string;
  author_username: string;
  author_avatar_url: string | null;
  author_is_trainer: boolean;
  can_delete: boolean;
};

type WorkoutCommentsProps = {
  workoutId: number;
  // "athlete" — эндпоинты кабинета атлета, "trainer" — тренерские (с модерацией)
  viewer: "athlete" | "trainer";
  onCountChange?: (count: number) => void;
};

export function WorkoutComments({ workoutId, viewer, onCountChange }: WorkoutCommentsProps) {
  const showToast = useToast();
  const base = viewer === "trainer" ? "/api/trainer" : "/api/athlete";
  const [comments, setComments] = useState<WorkoutCommentItem[] | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<{ comments: WorkoutCommentItem[] }>(`${base}/workouts/${workoutId}/comments`)
      .then((data) => {
        if (!cancelled) {
          setComments(data.comments);
          onCountChange?.(data.comments.length);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setComments([]);
        }
      });
    return () => {
      cancelled = true;
    };
    // onCountChange намеренно вне зависимостей: перезагружаем только по тренировке
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, workoutId]);

  async function send() {
    const body = text.trim();
    if (!body || sending) {
      return;
    }
    setSending(true);
    try {
      const res = await api<{ ok: true; comments: WorkoutCommentItem[] }>(
        `${base}/workouts/${workoutId}/comments`,
        { method: "POST", body: JSON.stringify({ body }) }
      );
      setComments(res.comments);
      onCountChange?.(res.comments.length);
      setText("");
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Не удалось отправить комментарий");
    } finally {
      setSending(false);
    }
  }

  async function remove(commentId: number) {
    if (!window.confirm("Удалить комментарий?")) {
      return;
    }
    try {
      await api(`${base}/comments/${commentId}`, { method: "DELETE" });
      setComments((prev) => {
        const next = (prev ?? []).filter((c) => c.id !== commentId);
        onCountChange?.(next.length);
        return next;
      });
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Не удалось удалить комментарий");
    }
  }

  return (
    <div className="wc">
      {comments === null ? (
        <div className="muted wc-loading">Загрузка комментариев…</div>
      ) : comments.length === 0 ? (
        <div className="muted wc-empty">Пока нет комментариев — будь первым.</div>
      ) : (
        <div className="wc-list">
          {comments.map((comment) => (
            <div className="wc-item" key={comment.id}>
              <UserAvatar
                fullName={comment.author_name}
                avatarUrl={comment.author_avatar_url}
                className="wc-avatar"
              />
              <div className="wc-body">
                <div className="wc-head">
                  <b>{comment.author_name}</b>
                  {comment.author_is_trainer ? <span className="wc-role">тренер</span> : null}
                  <span className="wc-ago">{formatAgo(comment.created_at)}</span>
                  {comment.can_delete ? (
                    <button
                      type="button"
                      className="wc-delete"
                      aria-label="Удалить комментарий"
                      onClick={() => remove(comment.id)}
                    >
                      Удалить
                    </button>
                  ) : null}
                </div>
                <p>{comment.body}</p>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="wc-compose">
        <textarea
          value={text}
          rows={1}
          maxLength={1000}
          placeholder="Написать комментарий…"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <button
          type="button"
          className="primary-button wc-send"
          disabled={sending || !text.trim()}
          onClick={() => void send()}
        >
          {sending ? "…" : "Отправить"}
        </button>
      </div>
    </div>
  );
}
