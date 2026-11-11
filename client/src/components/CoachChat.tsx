import { useEffect, useRef, useState } from "react";

import { api } from "../api";
import { useAuth } from "./AuthProvider";
import { useToast } from "./ToastProvider";
import { UserAvatar } from "./UserAvatar";
import type { WorkoutCommentItem } from "./WorkoutComments";

// Переписка спортсмена и тренера по пробежке — как в мессенджере: свои сообщения справа синими
// облачками, собеседника — слева серыми; снизу одна строка ввода с кнопкой отправки.
// Комментарий тренера — просто его сообщение здесь. Одногруппники переписку не видят.

const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function dayLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  const days = Math.round((new Date(today.toDateString()).getTime() - new Date(date.toDateString()).getTime()) / 86_400_000);
  if (days === 0) return "сегодня";
  if (days === 1) return "вчера";
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

function timeLabel(value: string) {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function CoachChat({
  workoutId,
  viewer,
  title,
  subtitle,
  placeholder,
  emptyText,
  peerAvatarUrl,
  channel = "coach",
  initialText
}: {
  workoutId: number;
  viewer: "athlete" | "trainer";
  title: string;
  subtitle?: string;
  placeholder: string;
  emptyText?: string;
  peerAvatarUrl?: string | null;
  // «club» — общий чат группы под пробежкой: имена у чужих сообщений, как в группе Telegram
  channel?: "coach" | "club";
  initialText?: string;
}) {
  const isGroup = channel === "club";
  const { user } = useAuth();
  const showToast = useToast();
  const base = viewer === "trainer" ? "/api/trainer" : "/api/athlete";
  const [messages, setMessages] = useState<WorkoutCommentItem[] | null>(null);
  const [text, setText] = useState(initialText ?? "");
  const [sending, setSending] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ comments: WorkoutCommentItem[] }>(`${base}/workouts/${workoutId}/comments?channel=${channel}`)
      .then((data) => !cancelled && setMessages(data.comments))
      .catch(() => !cancelled && setMessages([]));
    return () => {
      cancelled = true;
    };
  }, [base, workoutId]);

  // поле растёт под текст, но не больше 5 строк
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [text]);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const res = await api<{ ok: true; comments: WorkoutCommentItem[] }>(`${base}/workouts/${workoutId}/comments`, {
        method: "POST",
        body: JSON.stringify({ body, channel })
      });
      setMessages(res.comments);
      setText("");
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Не удалось отправить");
    } finally {
      setSending(false);
    }
  }

  async function remove(id: number) {
    if (!window.confirm("Удалить сообщение?")) return;
    try {
      await api(`${base}/comments/${id}`, { method: "DELETE" });
      setMessages((prev) => (prev ?? []).filter((item) => item.id !== id));
      setPicked(null);
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Не удалось удалить");
    }
  }

  let lastDay = "";
  // собеседник: из его сообщений (имя и фото), иначе — из того, что передала страница
  const peer = messages?.find((item) => item.author_id !== user?.id);
  const peerName = peer?.author_name ?? title;
  return (
    <div className="chat">
      {isGroup ? (
        <div className="chat-head">
          <div>
            <b>{title}</b>
            {subtitle ? <span>{subtitle}</span> : null}
          </div>
        </div>
      ) : (
        <div className="chat-head">
          <UserAvatar fullName={peerName} avatarUrl={peer?.author_avatar_url ?? peerAvatarUrl ?? null} className="chat-head-av" />
          <div>
            <b>{peerName}</b>
            <span>{subtitle ?? (viewer === "trainer" ? "спортсмен" : "тренер")}</span>
          </div>
        </div>
      )}
      {messages === null ? null : messages.length === 0 ? (
        emptyText ? <p className="chat-empty">{emptyText}</p> : null
      ) : (
        <div className="chat-list">
          {messages.map((message, index) => {
            const mine = message.author_id === user?.id;
            const next = messages[index + 1];
            const prev = messages[index - 1];
            // подряд от одного автора — склеиваем: аватар только у последнего, углы скруглены по-группе
            const lastInGroup = !next || next.author_id !== message.author_id || dayLabel(next.created_at) !== dayLabel(message.created_at);
            const firstInGroup = !prev || prev.author_id !== message.author_id || dayLabel(prev.created_at) !== dayLabel(message.created_at);
            const day = dayLabel(message.created_at);
            const showDay = day !== lastDay;
            lastDay = day;
            return (
              <div key={message.id}>
                {showDay ? <span className="chat-day">{day}</span> : null}
                <div className={`chat-row${mine ? " is-me" : ""}${firstInGroup ? "" : " is-cont"}${lastInGroup ? " is-last" : ""}`}>
                  {mine ? null : lastInGroup ? (
                    <UserAvatar fullName={message.author_name} avatarUrl={message.author_avatar_url} className="chat-av" />
                  ) : (
                    <span className="chat-av-gap" aria-hidden="true" />
                  )}
                  <button
                    type="button"
                    className="chat-bub"
                    onClick={() => (message.can_delete ? setPicked(picked === message.id ? null : message.id) : undefined)}
                    aria-label={`${message.author_name}: ${message.body}`}
                  >
                    {isGroup && !mine && firstInGroup ? (
                      <span className="chat-who">
                        {message.author_name.split(" ")[0]}
                        {message.author_is_trainer ? " · тренер" : ""}
                      </span>
                    ) : null}
                    <span className="chat-text">{message.body}</span>
                    <small>{timeLabel(message.created_at)}</small>
                  </button>
                </div>
                {picked === message.id ? (
                  <div className={mine ? "chat-act is-me" : "chat-act"}>
                    <button type="button" onClick={() => void remove(message.id)}>
                      Удалить
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
      <div className="chat-compose">
        <textarea
          ref={inputRef}
          value={text}
          rows={1}
          maxLength={1000}
          placeholder={placeholder}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <button type="button" className="chat-send" disabled={sending || !text.trim()} onClick={() => void send()} aria-label="Отправить">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </div>
    </div>
  );
}
