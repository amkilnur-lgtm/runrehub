import { useEffect, useState, useCallback } from "react";
import { api } from "../api";

export function useApi<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => {
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    if (!url) return;
    
    let isMounted = true;
    setLoading(true);
    setError(null);
    
    api<T>(url)
      .then((res) => {
        if (isMounted) {
          setData(res);
        }
      })
      .catch((err) => {
        if (isMounted) {
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
