import { useEffect, useMemo, useRef, useState } from "react";
import { Link as RouterLink, NavLink, useParams } from "react-router-dom";
import type { Link } from "../api";
import { hostOf, LinkStatus, n, statusOf } from "../format";
import { fetchStats, series, useStore } from "../store";
import { KeyIcon, SearchIcon, StackIcon } from "./Icons";
import Sparkline from "./Sparkline";
import ThemeToggle from "./ThemeToggle";

type Filter = "all" | LinkStatus;

function Row({ link, selected }: { link: Link; selected: boolean }) {
  const [vals, setVals] = useState<number[] | null>(null);
  const status = statusOf(link);
  useEffect(() => {
    let alive = true;
    fetchStats(link.short_code, "hour", 24).then(
      (s) => {
        // 24 hourly buckets folded into 12 two-hour points for the sparkline
        const h = series(s, "hour", 24).map((p) => p.clicks);
        if (alive) setVals(Array.from({ length: 12 }, (_, i) => h[i * 2] + h[i * 2 + 1]));
      },
      () => alive && setVals([]),
    );
    return () => {
      alive = false;
    };
  }, [link.short_code]);
  const total = vals ? vals.reduce((a, b) => a + b, 0) : null;
  return (
    <NavLink to={`/links/${link.short_code}`} className={`item ${status}`} aria-current={selected ? "page" : undefined} title={link.long_url}>
      <span className={`dot ${status}`} aria-label={status} />
      <div style={{ minWidth: 0 }}>
        <div className="c">/{link.short_code}</div>
        <div className="h">{hostOf(link.long_url)}</div>
      </div>
      <div className="n">
        <span>{total === null ? "·" : n(total)}</span>
        {vals && vals.length > 0 && <Sparkline values={vals} />}
      </div>
    </NavLink>
  );
}

export default function Rail() {
  const { links, loading, error, hasKey, setComposer } = useStore();
  const { code } = useParams();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const counts = useMemo(() => {
    const c = { all: links.length, active: 0, expired: 0, deleted: 0 };
    links.forEach((l) => c[statusOf(l)]++);
    return c;
  }, [links]);
  const shown = links.filter((l) => {
    if (filter !== "all" && statusOf(l) !== filter) return false;
    const t = q.trim().toLowerCase();
    return !t || l.short_code.toLowerCase().includes(t) || l.long_url.toLowerCase().includes(t);
  });

  return (
    <aside className="rail" aria-label="Your links">
      <div className="rail-top">
        <div className="brand">
          <RouterLink to="/"><span className="mark" />shortener</RouterLink>
          <span className="kbd" title="Press Ctrl+K or N for a new link">⌘K</span>
        </div>
        <button className="newbtn" onClick={() => setComposer(true)}>New link <span className="kbd">N</span></button>
        <label className="search"><SearchIcon /><input ref={searchRef} placeholder="Search links" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search links" /></label>
        <div className="filters" role="group" aria-label="Filter by status">
          {(["all", "active", "expired", "deleted"] as Filter[]).map((f) => (
            <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f[0].toUpperCase() + f.slice(1)} {counts[f]}
            </button>
          ))}
        </div>
      </div>
      {!hasKey && <div className="banner">Add your API key in <RouterLink to="/settings">Settings</RouterLink> to see your links. Run <code className="mono">make seed</code> to create one.</div>}
      <nav className="list">
        {error && <div className="rail-msg err">{error}</div>}
        {hasKey && loading && links.length === 0 && <div className="rail-msg"><span className="spin" /></div>}
        {hasKey && !loading && !error && shown.length === 0 && (
          <div className="rail-msg">{q || filter !== "all" ? "No links match." : "No links yet. Press N to create one."}</div>
        )}
        {shown.map((l) => <Row key={l.short_code} link={l} selected={l.short_code === code} />)}
      </nav>
      <div className="rail-foot">
        <button className="btn ghost" onClick={() => setComposer(true)}><StackIcon /> Bulk import</button>
        <div style={{ display: "flex", gap: 2 }}>
          <RouterLink className="btn ghost" to="/settings"><KeyIcon /> API key</RouterLink>
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}
