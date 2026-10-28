import { useEffect, useState } from "react";
import { Link as RouterLink, useNavigate, useParams } from "react-router-dom";
import { api, Link } from "../api";
import ClicksChart from "../components/ClicksChart";
import CopyButton, { copyText } from "../components/CopyButton";
import { BackIcon, EyeIcon, OpenIcon, TrashIcon } from "../components/Icons";
import QrCard from "../components/QrCard";
import { n, shortDate, splitUrl, statusOf } from "../format";
import { REFRESH_MS, series, useStats, useStore } from "../store";

/* The destination URL; hovering shows "Copy", clicking copies the full URL. */
function DestLine({ url, host, rest }: { url: string; host: string; rest: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await copyText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }
  return (
    <button type="button" className={`dest dest-copy${copied ? " copied" : ""}`} onClick={copy} title="Copy destination URL" aria-label={`Copy destination URL ${url}`}>
      → <b>{host}</b>{rest}
      <span className="dest-hint" aria-hidden="true">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

function Kpis({ code }: { code: string }) {
  const day = useStats(code, "hour", 48, REFRESH_MS);
  const month = useStats(code, "day", 24 * 30, REFRESH_MS);
  const h = series(day.data, "hour", 48).map((p) => p.clicks);
  const last = h.slice(24).reduce((a, b) => a + b, 0);
  const prev = h.slice(0, 24).reduce((a, b) => a + b, 0);
  const total30 = month.data ? month.data.total_clicks : null;
  const lastDay = series(day.data, "hour", 24);
  const peak = lastDay.reduce((m, p) => (p.clicks > m.clicks ? p : m), { t: 0, clicks: 0 });
  const change = prev ? Math.round(((last - prev) / prev) * 100) : null;
  return (
    <section className="panel kpis" aria-label="Click totals">
      <div className="kpi"><div className="l">Last 24 hours</div><div className="v">{day.data ? n(last) : "—"}</div>
        <div className={`d ${change === null ? "" : change >= 0 ? "up" : "down"}`}>{change === null ? "No clicks the day before" : `${change >= 0 ? "↑" : "↓"} ${Math.abs(change)}% vs day before`}</div></div>
      <div className="kpi"><div className="l">Last 30 days</div><div className="v">{total30 === null ? "—" : n(total30)}</div>
        <div className="d">{total30 === null ? "" : `${n(Math.round(total30 / 30))} a day`}</div></div>
      <div className="kpi"><div className="l">Busiest hour</div><div className="v">{peak.clicks ? new Date(peak.t).toLocaleTimeString(undefined, { hour: "numeric" }) : "—"}</div>
        <div className="d">{peak.clicks ? `${n(peak.clicks)} clicks` : "No clicks yet"}</div></div>
    </section>
  );
}

export default function LinkPage() {
  const { code = "" } = useParams();
  const { links, upsert } = useStore();
  const nav = useNavigate();
  const [link, setLink] = useState<Link | null>(links.find((l) => l.short_code === code) ?? null);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    setConfirming(false);
    const known = links.find((l) => l.short_code === code);
    if (known) return setLink(known);
    setLink(null);
    api.getLink(code).then(setLink, (e) => setError(e.message));
  }, [code, links]);

  if (error) return <div className="empty"><div><h2>Couldn't open /{code}</h2><p>{error}</p></div></div>;
  if (!link) return <div className="empty"><span className="spin" /></div>;

  const status = statusOf(link);
  const short = new URL(link.short_url);
  const dest = splitUrl(link.long_url);

  async function remove() {
    try {
      await api.deleteLink(code);
      upsert({ ...link!, is_active: false });
      setConfirming(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <header className="head">
        <div style={{ minWidth: 0 }}>
          <div className="crumb">
            <RouterLink to="/" className="only-narrow" aria-label="Back to links"><BackIcon /></RouterLink>
            <RouterLink to="/">Links</RouterLink> › <span className={`pill ${status}`}>{status[0].toUpperCase() + status.slice(1)}</span>
          </div>
          <h1 className="h1">
            {status === "active" ? (
              <a className="short-link" href={link.short_url} target="_blank" rel="noreferrer" title="Open the short link">
                <span>{short.host}/</span>{link.short_code}
              </a>
            ) : (
              <><span>{short.host}/</span>{link.short_code}</>
            )}
          </h1>
          <DestLine url={link.long_url} host={dest.host} rest={dest.rest} />
        </div>
        <div className="acts">
          {/* An expired or deleted link no longer redirects: nothing to copy, open or preview. */}
          {status === "active" && (
            <>
              <CopyButton text={link.short_url} className="btn primary" />
              <a className="btn" href={link.short_url} target="_blank" rel="noreferrer"><OpenIcon /> Open</a>
              <a className="btn" href={`${link.short_url}+`} target="_blank" rel="noreferrer"><EyeIcon /> Preview</a>
            </>
          )}
          {link.is_active && (
            <button className="btn icon danger-icon" aria-label="Delete link" title="Delete link" onClick={() => setConfirming(true)}><TrashIcon /></button>
          )}
        </div>
      </header>
      {confirming && (
        <div className="confirm" role="alert">
          <span>Delete <b className="mono">/{link.short_code}</b>? It stops redirecting immediately. Its click history stays.</span>
          <button className="btn danger" onClick={remove}>Delete</button>
          <button className="btn ghost" onClick={() => setConfirming(false)}>Cancel</button>
        </div>
      )}
      <div className="body">
        <div className="col">
          <Kpis code={code} />
          <ClicksChart code={code} />
          <p className="note">Only the time of each click is recorded: no IP address, device or referrer. Counts update a few seconds after each click; this page refreshes every 10 seconds.</p>
        </div>
        <div className="side">
          {status === "active" ? (
            <QrCard value={link.short_url} name={link.short_code} />
          ) : (
            <div className="panel inactive-note" role="note">
              <b>{status === "expired" ? "This link has expired" : "This link was deleted"}</b>
              <p>It no longer redirects, so there is no QR code to share. Its click history is kept.</p>
            </div>
          )}
          <div className="panel facts">
            <div><span>Created</span>{shortDate(link.created_at)}</div>
            <div><span>Expires</span>{link.expires_at ? shortDate(link.expires_at) : "Never"}</div>
            <div><span>Code</span><span className="mono" style={{ color: "var(--ink)" }}>{link.short_code}</span></div>
            <div><span>Redirect</span>302</div>
          </div>
          {status === "deleted" && <button className="btn" onClick={() => nav("/")}>Back to links</button>}
        </div>
      </div>
    </>
  );
}
