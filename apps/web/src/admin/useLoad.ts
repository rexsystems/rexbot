import { useCallback, useEffect, useRef, useState } from "react";
import { errorText } from "./format";

/** Loads data for an admin view, with loading/error state and an optional refresh interval. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[], refreshMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const request = useRef(0);
  const loader = useRef(load);
  loader.current = load;

  const reload = useCallback(async () => {
    const current = ++request.current;
    setLoading(true);
    try {
      const next = await loader.current();
      if (current !== request.current) return;
      setData(next);
      setError(null);
    } catch (err) {
      if (current === request.current) setError(errorText(err));
    } finally {
      if (current === request.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void reload();
    return () => { request.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    if (!refreshMs) return;
    const timer = window.setInterval(() => void reload(), refreshMs);
    return () => window.clearInterval(timer);
  }, [refreshMs, reload]);

  return { data, error, loading, reload, setData };
}
