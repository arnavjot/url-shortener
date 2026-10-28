import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api, getApiKey, Link, Stats } from "./api";

interface Store {
  links: Link[];
  loading: boolean;
  error: string;
  hasKey: boolean;
  refresh: () => Promise<void>;
  upsert: (link: Link) => void;
  composer: boolean;
  setComposer: (open: boolean) => void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [links, setLinks] = useState<Link[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hasKey, setHasKey] = useState(!!getApiKey());
  const [composer, setComposer] = useState(false);

  const refresh = useCallback(async () => {
    if (!getApiKey()) {
      setLinks([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      setLinks(await api.listLinks(200));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const onKey = () => {
      setHasKey(!!getApiKey());
      statsCache.clear();
      refresh();
    };
    window.addEventListener("apikey", onKey);
    return () => window.removeEventListener("apikey", onKey);
  }, [refresh]);

  const upsert = useCallback((link: Link) => {
    setLinks((ls) => [link, ...ls.filter((l) => l.short_code !== link.short_code)]);
  }, []);

  return (
    <Ctx.Provider value={{ links, loading, error, hasKey, refresh, upsert, composer, setComposer }}>
      {children}
    </Ctx.Provider>
  );
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside StoreProvider");
  return s;
}

/* Stats, cached for 30 s per (code, granularity, window) so the list and the
   detail pane share requests. */
const statsCache = new Map<string, { at: number; p: Promise<Stats> }>();
const TTL = 30_000;
/* How often an open link page refetches its stats. */
export const REFRESH_MS = 10_000;

export function fetchStats(code: string, gran: "hour" | "day", hoursBack: number, fresh = false): Promise<Stats> {
  const key = `${code}|${gran}|${hoursBack}`;
  const hit = statsCache.get(key);
  if (!fresh && hit && Date.now() - hit.at < TTL) return hit.p;
  const from = new Date(Date.now() - hoursBack * 3600_000);
  const p = api.stats(code, gran, from);
  statsCache.set(key, { at: Date.now(), p });
  p.catch(() => statsCache.delete(key));
  return p;
}

/* Stats for one link. With refreshMs, refetched on that interval (and when the
   tab becomes visible again) so new clicks show up without reopening the link. */
export function useStats(code: string | undefined, gran: "hour" | "day", hoursBack: number, refreshMs = 0) {
  const [data, setData] = useState<Stats | null>(null);
  const [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    setData(null);
    setError("");
    if (!code) return;
    const load = (fresh: boolean) =>
      fetchStats(code, gran, hoursBack, fresh).then(
        (d) => { if (alive.current) { setData(d); setError(""); } },
        (e) => alive.current && setError(e.message)
      );
    load(false);
    if (!refreshMs) return () => { alive.current = false; };
    const tick = () => { if (document.visibilityState === "visible") load(true); };
    const id = window.setInterval(tick, refreshMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      alive.current = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [code, gran, hoursBack, refreshMs]);
  return { data, error };
}

/* Fill missing buckets with zero so charts have a continuous x-axis. */
export function series(stats: Stats | null, gran: "hour" | "day", count: number): { t: number; clicks: number }[] {
  const step = gran === "hour" ? 3600_000 : 86400_000;
  const now = new Date();
  const end = gran === "hour"
    ? Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours())
    : Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const by = new Map((stats?.series ?? []).map((p) => [new Date(p.bucket_start).getTime(), p.clicks]));
  return Array.from({ length: count }, (_, i) => {
    const t = end - (count - 1 - i) * step;
    return { t, clicks: by.get(t) ?? 0 };
  });
}
