import { useEffect, useState } from "react";

import { api } from "../api";
import { useApi } from "../hooks/useApi";
import { FeedCard, type FeedItem } from "./FeedCard";

type FeedData = {
  feed: FeedItem[];
  nextCursor: { beforeDate: string; beforeId: number } | null;
};

export function AthleteFeed() {
  const { data, loading, error } = useApi<FeedData>("/api/athlete/feed");
  const [extra, setExtra] = useState<FeedItem[]>([]);
  const [nextCursor, setNextCursor] = useState<FeedData["nextCursor"]>(null);
  const [loadingMore, setLoadingMore] = useState(false);

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
      const more = await api<FeedData>(`/api/athlete/feed?${search.toString()}`);
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
  if (items.length === 0) {
    return (
      <section className="card">
        <div className="trainer-dashboard-leader-empty">
          <strong>Пока пусто.</strong>
          <div className="muted">
            Здесь появятся свежие пробежки твоей группы, как только кто-нибудь синхронизирует тренировку.
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="feed-list">
      {items.map((item) => (
        <FeedCard key={item.id} item={item} />
      ))}
      {nextCursor ? (
        <button className="feed-more" type="button" disabled={loadingMore} onClick={loadMore}>
          {loadingMore ? "Загрузка…" : "Показать ещё"}
        </button>
      ) : null}
    </div>
  );
}
