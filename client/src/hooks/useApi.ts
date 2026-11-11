import { useEffect, useRef, useState, useCallback } from "react";
import { api } from "../api";

// Память последних ответов по адресу: при возврате «назад» экран сразу рисуется
// прежними данными (и прокрутка встаёт на место), а свежие подтягиваются в фоне
const cache = new Map<string, unknown>();
const CACHE_LIMIT = 40;

function remember(url: string, value: unknown) {
  cache.delete(url);
  cache.set(url, value);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

// после изменений (удалили, переименовали) старый ответ не показываем
// заранее загрузить ответ в кэш (соседние вкладки, переключатели) — переход без ожидания
export function prefetchApi(url: string) {
  if (cache.has(url)) return;
  void api(url)
    .then((res) => remember(url, res))
    .catch(() => undefined);
}

export function forgetApiCache(prefix?: string) {
  for (const key of [...cache.keys()]) {
    if (!prefix || key.startsWith(prefix)) cache.delete(key);
  }
}

export function useApi<T>(url: string | null) {
  const [data, setData] = useState<T | null>(() => (url && cache.has(url) ? (cache.get(url) as T) : null));
  const [loading, setLoading] = useState<boolean>(() => !(url && cache.has(url)));
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const loadedUrl = useRef<string | null>(url);

  const refresh = useCallback(() => {
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    if (!url) return;

    let isMounted = true;
    // другой адрес (перешли к другому спортсмену) — чужие данные не показываем;
    // если этот адрес уже открывали — сразу показываем запомненный ответ
    if (loadedUrl.current !== url) {
      loadedUrl.current = url;
      setData(cache.has(url) ? (cache.get(url) as T) : null);
    }
    const hasData = cache.has(url);
    // фоновое обновление не прячет экран за скелетоном
    if (!hasData) setLoading(true);
    setError(null);

    api<T>(url)
      .then((res) => {
        if (isMounted) {
          remember(url, res);
          setData(res);
        }
      })
      .catch((err) => {
        if (isMounted && !hasData) {
          setError(err.message || "Failed to load data");
        }
      })
      .finally(() => {
        if (isMounted) {
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [url, tick]);

  return { data, loading, error, refresh };
}
