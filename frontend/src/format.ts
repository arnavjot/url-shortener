import type { Link } from "./api";

export type LinkStatus = "active" | "expired" | "deleted";

export function statusOf(link: Link): LinkStatus {
  if (!link.is_active) return "deleted";
  if (link.expires_at !== null && new Date(link.expires_at) <= new Date()) return "expired";
  return "active";
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function splitUrl(url: string): { host: string; rest: string } {
  try {
    const u = new URL(url);
    return { host: u.host, rest: u.pathname + u.search + u.hash };
  } catch {
    return { host: url, rest: "" };
  }
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export const n = (x: number) => x.toLocaleString("en-US");
