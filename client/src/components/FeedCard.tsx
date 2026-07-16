import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { api } from "../api";
import { useToast } from "./ToastProvider";
import { UserAvatar } from "./UserAvatar";
import { RouteTrack } from "./RouteTrack";
import { formatAgo, formatDistance, formatDuration, formatPace } from "../lib";

export type FeedItem = {
  id: number;
  name: string;
  sport_type: string;
  start_date: string;
  athlete_id: number;
  athlete_name: string;
  athlete_username: string;
  athlete_avatar_url: string | null;
  distance_meters: number;
  moving_time_seconds: number;
  elevation_gain: number;
  average_speed: number | null;
  average_heartrate: number | null;
  like_count: number;
  liked_by_me: boolean;
  route: [number, number][] | null;
};

const HeartIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path
      d="M12 20.3 4.6 13a4.6 4.6 0 0 1 6.5-6.5l.9.9.9-.9A4.6 4.6 0 0 1 19.4 13Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinejoin="round"
    />
  </svg>
);

export function FeedCard({ item }: { item: FeedItem }) {
  const navigate = useNavigate();
  const showToast = useToast();
  const [liked, setLiked] = useState(item.liked_by_me);
  const [count, setCount] = useState(item.like_count);
  const [pending, setPending] = useState(false);

  async function toggleLike() {
    if (pending) {
      return;
    }
    const next = !liked;
    // оптимистично
    setLiked(next);
    setCount((c) => c + (next ? 1 : -1));
    setPending(true);
    try {
      const res = await api<{ ok: true; like_count: number; liked_by_me: boolean }>(
        `/api/athlete/workouts/${item.id}/like`,
        { method: next ? "POST" : "DELETE" }
      );
      setLiked(res.liked_by_me);
      setCount(res.like_count);
    } catch (err) {
      setLiked(!next);
      setCount((c) => c + (next ? -1 : 1));
      showToast("error", err instanceof Error ? err.message : "Не удалось поставить лайк");
    } finally {
      setPending(false);
    }
  }

  const stats: Array<[string, string]> = [
    [formatDistance(item.distance_meters), "дистанция"],
    [formatDuration(item.moving_time_seconds), "время"],
    [formatPace(item.average_speed).replace("/км", ""), "темп /км"]
  ];
  if (item.average_heartrate) {
    stats.push([String(Math.round(item.average_heartrate)), "ср. пульс"]);
  }

  return (
    <article className="feed-card">
      <header className="feed-top">
        <div className="feed-author">
          <UserAvatar
            fullName={item.athlete_name}
            avatarUrl={item.athlete_avatar_url}
            className="feed-avatar"
          />
          <div className="feed-who">
            <div className="feed-who-line">
              <b>{item.athlete_name}</b>
              <span className="feed-handle">@{item.athlete_username}</span>
            </div>
            <span className="feed-ago">{formatAgo(item.start_date)}</span>
          </div>
        </div>
      </header>

      <Link to={`/athlete/workouts/${item.id}`} className="feed-run-link">
        <div className="feed-run-title">{item.name}</div>
        {item.route ? <RouteTrack points={item.route} /> : null}
        <div className="feed-stats">
          {stats.map(([value, label]) => (
            <div className="feed-stat" key={label}>
              <b>{value}</b>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </Link>

      <footer className="feed-actions">
        <button
          type="button"
          className={`feed-act feed-like${liked ? " is-liked" : ""}`}
          aria-pressed={liked}
          onClick={toggleLike}
        >
          <HeartIcon />
          <span className="feed-n">{count}</span>
        </button>
        <button
          type="button"
          className="feed-act"
          onClick={() => navigate(`/athlete/workouts/${item.id}`)}
        >
          Открыть разбор
        </button>
      </footer>
    </article>
  );
}
