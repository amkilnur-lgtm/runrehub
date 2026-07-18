import { useEffect, useState } from "react";

import { Link } from "react-router-dom";

import { api } from "../api";
import { useApi } from "../hooks/useApi";
import { formatDistance } from "../lib";
import { FeedCard, type FeedItem } from "./FeedCard";
import { UserAvatar } from "./UserAvatar";

type FeedLeader = {
  id: number;
  full_name: string;
  username: string;
  avatar_url: string | null;
  week_distance_meters: number;
  week_workout_count: number;
};

type FeedData = {
  feed: FeedItem[];
  nextCursor: { beforeDate: string; beforeId: number } | null;
  leaders?: FeedLeader[];
};

export function AthleteFeed({ viewer = "athlete" }: { viewer?: "athlete" | "trainer" }) {
  const { data, loading, error } = useApi<FeedData>(`/api/${viewer}/feed`);
  const [extra, setExtra] = useState<FeedItem[]>([]);
  const [nextCursor, setNextCursor] = useState<FeedData["nextCursor"]>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [leaderboard, setLeaderboard] = useState<FeedLeader[] | null>(null);

  async function toggleLeaderboard() {
    const next = !leaderboardOpen;
    setLeaderboardOpen(next);
    if (next && leaderboard === null) {
      try {
        const res = await api<{ leaderboard: FeedLeader[] }>("/api/athlete/leaderboard");
        setLeaderboard(res.leaderboard);
      } catch {
        setLeaderboard([]);
      }
    }
  }

  useEffect(() => {
    if (data) {
      setExtra([]);
      setNextCursor(data.nextCursor);
    }
  }, [data]);

  async function loadMore() {
    if (!nextCursor || loadingMore) {
      return;
    }
    setLoadingMore(true);
    try {
      const search = new URLSearchParams({
        beforeDate: nextCursor.beforeDate,
        beforeId: String(nextCursor.beforeId)
      });
      const more = await api<FeedData>(`/api/${viewer}/feed?${search.toString()}`);
      setExtra((prev) => [...prev, ...more.feed]);
      setNextCursor(more.nextCursor);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingMore(false);
    }
  }

  if (loading) {
    return <section className="card skeleton-card" style={{ minHeight: 220 }} />;
  }
  if (error || !data) {
    return (
      <section className="card">
        <p className="muted">{error || "Не удалось загрузить ленту"}</p>
      </section>
    );
  }

  const items = [...data.feed, ...extra];
  const leaders = data.leaders ?? [];
  const shownLeaders = leaderboardOpen && leaderboard !== null ? leaderboard : leaders;
  const leadersBlock =
    leaders.length > 0 ? (
      <section className="card feed-leaders-card">
        <div className="trainer-dashboard-heading">
          <span className="muted trainer-dashboard-eyebrow">
            {leaderboardOpen ? "Километраж недели" : "Топ-3 на неделе"}
          </span>
        </div>
        <div className="trainer-dashboard-leader-list">
          {shownLeaders.map((leader, index) => (
            <Link
              key={leader.id}
              className="trainer-dashboard-leader-row"
              to={`/${viewer}/athletes/${leader.id}`}
            >
              <div className="trainer-dashboard-leader-rank">{index + 1}</div>
              <UserAvatar
                fullName={leader.full_name}
                avatarUrl={leader.avatar_url}
                className="trainer-dashboard-leader-avatar"
                ariaHidden
              />
              <div className="trainer-dashboard-leader-text">
                <strong>{leader.full_name}</strong>
                <div className="muted">@{leader.username}</div>
              </div>
              <div className="trainer-dashboard-leader-distance">
                {formatDistance(leader.week_distance_meters)}
              </div>
            </Link>
          ))}
          {leaderboardOpen && leaderboard === null ? (
            <div className="muted feed-leaders-loading">Загрузка…</div>
          ) : null}
        </div>
        <button type="button" className="feed-leaders-toggle" onClick={() => void toggleLeaderboard()}>
          {leaderboardOpen ? "Свернуть" : "Посмотреть всех"}
        </button>
      </section>
    ) : null;

  if (items.length === 0) {
    return (
      <div className="feed-list">
        {leadersBlock}
        <section className="card">
          <div className="trainer-dashboard-leader-empty">
            <strong>Пока пусто.</strong>
            <div className="muted">
              Здесь появятся свежие пробежки твоей группы, как только кто-нибудь синхронизирует тренировку.
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="feed-list">
      {leadersBlock}
      {items.map((item) => (
        <FeedCard key={item.id} item={item} viewer={viewer} />
      ))}
      {nextCursor ? (
        <button className="feed-more" type="button" disabled={loadingMore} onClick={loadMore}>
          {loadingMore ? "Загрузка…" : "Показать ещё"}
        </button>
      ) : null}
    </div>
  );
}
