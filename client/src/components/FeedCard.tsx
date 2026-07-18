import { useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../api";
import { useAuth } from "./AuthProvider";
import { useToast } from "./ToastProvider";
import { UserAvatar } from "./UserAvatar";
import { RouteStaticMap } from "./RouteStaticMap";
import { WorkoutComments } from "./WorkoutComments";
import { formatAgo, formatDistance, formatDuration, formatPace } from "../lib";

type FeedLiker = {
  id: number;
  full_name: string;
  avatar_url: string | null;
};

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
  comment_count: number;
  likers: FeedLiker[];
  route: [number, number][] | null;
};

type LikerRow = {
  id: number;
  full_name: string;
  username: string;
  avatar_url: string | null;
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

const BubbleIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path
      d="M4 5.5h16v10H12l-4.5 3.3V15.5H4Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinejoin="round"
    />
  </svg>
);

type FeedViewer = "athlete" | "trainer";

export function FeedCard({ item, viewer = "athlete" }: { item: FeedItem; viewer?: FeedViewer }) {
  const { user } = useAuth();
  const apiBase = `/api/${viewer}`;
  const workoutHref = `/${viewer}/workouts/${item.id}`;
  const athleteHref = viewer === "trainer" ? `/trainer/athletes/${item.athlete_id}` : `/athlete/athletes/${item.athlete_id}`;
  const showToast = useToast();
  const [liked, setLiked] = useState(item.liked_by_me);
  const [count, setCount] = useState(item.like_count);
  const [likers, setLikers] = useState<FeedLiker[]>(item.likers);
  const [pending, setPending] = useState(false);
  const [commentCount, setCommentCount] = useState(item.comment_count);
  const [showComments, setShowComments] = useState(false);
  const [likersOpen, setLikersOpen] = useState(false);
  const [likersList, setLikersList] = useState<LikerRow[] | null>(null);

  function applyLikersPreview(nextLiked: boolean) {
    if (!user) {
      return;
    }
    setLikers((prev) => {
      const withoutMe = prev.filter((liker) => liker.id !== user.id);
      if (!nextLiked) {
        return withoutMe;
      }
      return [{ id: user.id, full_name: user.fullName, avatar_url: user.avatarUrl }, ...withoutMe].slice(0, 3);
    });
  }

  async function toggleLike() {
    if (pending) {
      return;
    }
    const next = !liked;
    // оптимистично
    setLiked(next);
    setCount((c) => c + (next ? 1 : -1));
    applyLikersPreview(next);
    setLikersList(null);
    setPending(true);
    try {
      const res = await api<{ ok: true; like_count: number; liked_by_me: boolean }>(
        `${apiBase}/workouts/${item.id}/like`,
        { method: next ? "POST" : "DELETE" }
      );
      setLiked(res.liked_by_me);
      setCount(res.like_count);
    } catch (err) {
      setLiked(!next);
      setCount((c) => c + (next ? -1 : 1));
      applyLikersPreview(!next);
      showToast("error", err instanceof Error ? err.message : "Не удалось поставить лайк");
    } finally {
      setPending(false);
    }
  }

  async function toggleLikers() {
    const next = !likersOpen;
    setLikersOpen(next);
    if (next && likersList === null) {
      try {
        const res = await api<{ likers: LikerRow[] }>(`${apiBase}/workouts/${item.id}/likes`);
        setLikersList(res.likers);
      } catch {
        setLikersList([]);
      }
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

  const hiddenLikers = Math.max(0, count - likers.length);

  return (
    <article className="feed-card">
      <header className="feed-top">
        <Link to={athleteHref} className="feed-author">
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
        </Link>
      </header>

      <Link to={workoutHref} className="feed-run-link">
        <div className="feed-run-title">{item.name}</div>
        {item.route ? <RouteStaticMap points={item.route} /> : null}
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
        {likers.length > 0 ? (
          <button
            type="button"
            className="feed-likers"
            aria-expanded={likersOpen}
            title="Кто лайкнул"
            onClick={() => void toggleLikers()}
          >
            {likers.map((liker) => (
              <UserAvatar
                key={liker.id}
                fullName={liker.full_name}
                avatarUrl={liker.avatar_url}
                className="feed-liker-avatar"
                ariaHidden
              />
            ))}
            {hiddenLikers > 0 ? <span className="feed-likers-more">+{hiddenLikers}</span> : null}
          </button>
        ) : null}
        <button
          type="button"
          className="feed-act"
          aria-expanded={showComments}
          onClick={() => setShowComments((open) => !open)}
        >
          <BubbleIcon />
          <span className="feed-n">{commentCount}</span>
        </button>
      </footer>

      {likersOpen ? (
        <div className="feed-likers-panel">
          {likersList === null ? (
            <span className="muted">Загрузка…</span>
          ) : likersList.length === 0 ? (
            <span className="muted">Пока никто не лайкнул.</span>
          ) : (
            likersList.map((liker) => (
              <div className="feed-likers-row" key={liker.id}>
                <UserAvatar fullName={liker.full_name} avatarUrl={liker.avatar_url} className="wc-avatar" ariaHidden />
                <b>{liker.full_name}</b>
                <span className="muted">@{liker.username}</span>
              </div>
            ))
          )}
        </div>
      ) : null}

      {showComments ? (
        <div className="feed-comments">
          <WorkoutComments workoutId={item.id} viewer={viewer} onCountChange={setCommentCount} />
        </div>
      ) : null}
    </article>
  );
}
