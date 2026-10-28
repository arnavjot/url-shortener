// Thin client for the FastAPI backend. The API key lives in localStorage and is
// sent as X-API-Key; requests go to /api on the same origin (proxied in dev/nginx).

export interface Link {
  short_code: string;
  short_url: string;
  long_url: string;
  is_active: boolean;
  expires_at: string | null;
  created_at: string;
}

export interface Stats {
  short_code: string;
  granularity: "hour" | "day";
  total_clicks: number;
  series: { bucket_start: string; clicks: number }[];
}

export interface BulkResult {
  index: number;
  ok: boolean;
  link: Link | null;
  error: string | null;
}

export interface NewLink {
  long_url: string;
  custom_alias?: string;
  expires_at?: string;
}

const KEY = "apiKey";

export function getApiKey(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function setApiKey(value: string) {
  try {
    if (value) localStorage.setItem(KEY, value);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: key lasts for this page load only */
  }
  window.dispatchEvent(new Event("apikey"));
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "X-API-Key": getApiKey(), ...init.headers },
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") message = body.detail;
      else if (Array.isArray(body.detail)) message = body.detail[0]?.msg?.replace(/^Value error, /, "") ?? message;
    } catch {
      /* non-JSON error */
    }
    if (res.status === 401) message = "Invalid API key. Check Settings.";
    if (res.status === 429) message = `Rate limit hit. Try again in ${res.headers.get("Retry-After") ?? "a few"}s.`;
    throw new ApiError(res.status, message);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

// At most 4 stats requests in flight, so loading a long list doesn't burst
// through the API key's rate limit.
const MAX_IN_FLIGHT = 4;
let inFlight = 0;
const waiting: (() => void)[] = [];
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((r) => waiting.push(r));
  inFlight++;
  try {
    return await fn();
  } finally {
    inFlight--;
    waiting.shift()?.();
  }
}

export const api = {
  createLink: (body: NewLink) => request<Link>("/links", { method: "POST", body: JSON.stringify(body) }),
  createBulk: (links: NewLink[]) =>
    request<{ created: number; failed: number; results: BulkResult[] }>("/links/bulk", {
      method: "POST",
      body: JSON.stringify({ links }),
    }),
  listLinks: (limit = 50, offset = 0) => request<Link[]>(`/links?limit=${limit}&offset=${offset}`),
  getLink: (code: string) => request<Link>(`/links/${encodeURIComponent(code)}`),
  deleteLink: (code: string) => request<void>(`/links/${encodeURIComponent(code)}`, { method: "DELETE" }),
  stats: (code: string, granularity: "hour" | "day", from?: Date) =>
    limited(() =>
      request<Stats>(
        `/links/${encodeURIComponent(code)}/stats?granularity=${granularity}` +
          (from ? `&from=${encodeURIComponent(from.toISOString())}` : ""),
      ),
    ),
  checkAlias: (alias: string) =>
    request<{ alias: string; available: boolean; reason: string | null }>(
      `/aliases/${encodeURIComponent(alias)}`,
    ),
};
