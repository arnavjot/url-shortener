import { FormEvent, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, BulkResult, NewLink } from "../api";
import { useStore } from "../store";

const MAX_BULK = 50;

function parse(text: string): NewLink[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^(long_)?url\b/i.test(l))
    .map((l) => {
      const [long_url, alias] = l.split(/[,\s]+/);
      return alias ? { long_url, custom_alias: alias } : { long_url };
    });
}

function useAliasCheck(alias: string) {
  const [state, setState] = useState<{ s: "idle" | "checking" | "ok" | "bad"; reason?: string }>({ s: "idle" });
  useEffect(() => {
    if (!alias) return setState({ s: "idle" });
    setState({ s: "checking" });
    let off = false;
    const t = setTimeout(() => {
      api.checkAlias(alias).then(
        (r) => !off && setState(r.available ? { s: "ok" } : { s: "bad", reason: r.reason ?? "Unavailable" }),
        () => !off && setState({ s: "idle" }),
      );
    }, 350);
    return () => {
      off = true;
      clearTimeout(t);
    };
  }, [alias]);
  return state;
}

export default function Composer() {
  const { setComposer, upsert, refresh } = useStore();
  const nav = useNavigate();
  const [text, setText] = useState("");
  const [alias, setAlias] = useState("");
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [bulk, setBulk] = useState<{ rows: NewLink[]; results: BulkResult[] } | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const rows = parse(text);
  const isBulk = rows.length > 1;
  const check = useAliasCheck(isBulk ? "" : alias.trim());
  const close = () => setComposer(false);

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!rows.length || busy) return;
    setBusy(true);
    setError("");
    try {
      if (isBulk) {
        const res = await api.createBulk(rows);
        setBulk({ rows, results: res.results });
        refresh();
      } else {
        const body: NewLink = { long_url: rows[0].long_url };
        if (alias.trim()) body.custom_alias = alias.trim();
        if (expires) body.expires_at = new Date(expires).toISOString();
        const link = await api.createLink(body);
        upsert(link);
        close();
        nav(`/links/${link.short_code}`);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const created = bulk?.results.filter((r) => r.ok).length ?? 0;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <form className="composer" role="dialog" aria-modal="true" aria-label="New link" onSubmit={submit}>
        {bulk ? (
          <>
            <div style={{ padding: "16px 18px", fontWeight: 600 }}>{created} created{bulk.results.length - created ? ` · ${bulk.results.length - created} failed` : ""}</div>
            <div className="bulk-list">
              {bulk.results.map((r) => (
                <div key={r.index} className="bulk-row">
                  <span className={r.ok ? "ok" : "bad"}>{r.ok ? "✓" : "✗"}</span>
                  <span className="u">{bulk.rows[r.index]?.long_url}</span>
                  {r.ok ? <span className="mono" style={{ color: "var(--accent)" }}>/{r.link!.short_code}</span> : <span className="bad">{r.error}</span>}
                </div>
              ))}
            </div>
            <div className="foot"><span /><button type="button" className="btn primary" onClick={close}>Done</button></div>
          </>
        ) : (
          <>
            <textarea
              ref={ref}
              rows={isBulk ? Math.min(8, rows.length + 1) : 2}
              placeholder={"Paste a long URL\nor several, one per line, to shorten in bulk"}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !isBulk) { e.preventDefault(); submit(); } }}
              aria-label="Long URL"
            />
            {!isBulk && (
              <div className="opts">
                <div className="field">
                  <label htmlFor="alias">Alias (optional)</label>
                  <input id="alias" className="input" placeholder="my-launch" maxLength={32} value={alias} onChange={(e) => setAlias(e.target.value)} />
                  <div className={`hint ${check.s === "ok" ? "ok" : check.s === "bad" ? "bad" : ""}`}>
                    {check.s === "checking" ? "Checking…" : check.s === "ok" ? "✓ Available" : check.s === "bad" ? `✗ ${check.reason}` : ""}
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="exp">Expires (optional)</label>
                  <input id="exp" className="input" type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} />
                  <div className="hint">Leave empty to keep it forever.</div>
                </div>
              </div>
            )}
            {error && <div className="err" style={{ padding: "0 18px 12px" }}>{error}</div>}
            <div className="foot">
              <span>{isBulk ? (rows.length > MAX_BULK ? `Too many lines (${rows.length}/${MAX_BULK})` : `${rows.length} links · add ",alias" after a URL to name it`) : "Paste several lines to shorten in bulk · Esc to close"}</span>
              <span style={{ display: "flex", gap: 6 }}>
                <button type="button" className="btn" onClick={close}>Cancel</button>
                <button className="btn primary" disabled={busy || !rows.length || rows.length > MAX_BULK || check.s === "bad"}>
                  {busy ? <span className="spin" /> : isBulk ? `Create ${rows.length} links` : "Create link ↵"}
                </button>
              </span>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
