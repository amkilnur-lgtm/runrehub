import { useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../api";
import { useAuth } from "./AuthProvider";
import { useToast } from "./ToastProvider";
import { UserAvatar } from "./UserAvatar";
import { RouteStaticMap } from "./RouteStaticMap";
import { formatAgo, formatDuration, formatPace, formatKm } from "../lib";

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

  const hiddenLikers = Math.max(0, count - likers.length);
  // «Таня, Даян и ещё 2» — кто поддержал, словами
  const likersText = likers.length
    ? `${likers
        .slice(0, 2)
        .map((liker) => liker.full_name.split(" ")[0])
        .join(", ")}${count > 2 ? ` и ещё ${count - 2}` : ""}`
    : count === 0
      ? "поставьте первым"
      : "";

  // карточка ленты (вариант А): как главная и страница пробежки — крупно км, ниже время · темп · пульс
  return (
    <article className="feed-card fc2">
      <header className="fc2-head">
        <Link to={athleteHref} className="fc2-author">
          <UserAvatar fullName={item.athlete_name} avatarUrl={item.athlete_avatar_url} className="fc2-av" />
          <div>
            <b>{item.athlete_name}</b>
            <span>{formatAgo(item.start_date)}</span>
          </div>
        </Link>
      </header>

      <Link to={workoutHref} className="feed-run-link fc2-run">
        <div className="fc2-title">{item.name}</div>
        <div className="fc2-big">
          {formatKm(item.distance_meters, 2)}
          <small>км</small>
        </div>
        <div className="workout-stats-row fc2-stats">
          <div>
            <span>время</span>
            <b>{formatDuration(item.moving_time_seconds)}</b>
          </div>
          <div>
            <span>темп</span>
            <b>{formatPace(item.average_speed).replace("/км", "").trim()}</b>
          </div>
          <div>
            <span>пульс</span>
            <b>{item.average_heartrate ? Math.round(item.average_heartrate) : "—"}</b>
          </div>
        </div>
        {item.route ? (
          <div className="fc2-map">
            <RouteStaticMap points={item.route} />
          </div>
        ) : null}
      </Link>

      <footer className="feed-actions fc2-foot">
        <button
          type="button"
          className={`feed-act feed-like${liked ? " is-liked" : ""}`}
          aria-pressed={liked}
          onClick={toggleLike}
        >
          <HeartIcon />
          <span className="feed-n">{count}</span>
        </button>
        {likersText ? (
          <button
            type="button"
            className="fc2-likers"
            aria-expanded={likersOpen}
            disabled={!likers.length}
            onClick={() => void toggleLikers()}
          >
            {likersText}
          </button>
        ) : null}
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

    </article>
  );
}
