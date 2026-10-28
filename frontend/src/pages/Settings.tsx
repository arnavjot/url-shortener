import { FormEvent, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { api, getApiKey, setApiKey } from "../api";
import { BackIcon } from "../components/Icons";

export default function Settings() {
  const [key, setKey] = useState(getApiKey());
  const [show, setShow] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setStatus(null);
    if (!key.trim()) {
      setApiKey("");
      return setStatus({ ok: true, text: "Key removed." });
    }
    setBusy(true);
    setApiKey(key.trim());
    try {
      await api.listLinks(1);
      setStatus({ ok: true, text: "Saved. The key works." });
    } catch (err) {
      setStatus({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <RouterLink to="/" className="btn ghost only-narrow" style={{ justifySelf: "start" }}><BackIcon /> Links</RouterLink>
      <h1>API key</h1>
      <form onSubmit={save} className="panel">
        <div className="field">
          <label htmlFor="key">Key</label>
          <div style={{ display: "flex", gap: 6 }}>
            <input id="key" className="input" type={show ? "text" : "password"} autoComplete="off" placeholder="Paste the key printed by make seed" value={key} onChange={(e) => setKey(e.target.value)} />
            <button type="button" className="btn" onClick={() => setShow(!show)}>{show ? "Hide" : "Show"}</button>
          </div>
          <div className="hint">Stored only in this browser and sent as the X-API-Key header.</div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button className="btn primary" disabled={busy}>{busy ? <span className="spin" /> : "Save & test"}</button>
          {status && <span className={`hint ${status.ok ? "ok" : "bad"}`} style={{ margin: 0 }}>{status.text}</span>}
        </div>
      </form>
      <div className="panel">
        <b>Don't have a key?</b>
        <span className="note">With the stack running, create one with:</span>
        <pre>make seed</pre>
      </div>
    </div>
  );
}
