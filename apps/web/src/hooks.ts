import { useCallback, useEffect, useRef, useState } from "react";

export interface Loadable<T> { data: T | null; error: string | null; loading: boolean; reload: () => void }

/** Carrega dados e, opcionalmente, volta a consultar periodicamente (estado real, vindo da API). */
export function useLoad<T>(fn: () => Promise<T>, pollMs?: number, key: unknown = null): Loadable<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const load = useCallback(async () => {
    try {
      setData(await fnRef.current());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    if (!pollMs) return;
    const t = setInterval(() => void load(), pollMs);
    return () => clearInterval(t);
  }, [load, pollMs, key]);
  return { data, error, loading, reload: () => void load() };
}
