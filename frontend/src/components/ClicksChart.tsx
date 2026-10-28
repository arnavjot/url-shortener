import { useState } from "react";
import { REFRESH_MS, series, useStats } from "../store";

const W = 640, H = 200, TOP = 24, BOTTOM = 16, PADX = 10;

export default function ClicksChart({ code }: { code: string }) {
  const [gran, setGran] = useState<"hour" | "day">("hour");
  const { data, error } = useStats(code, gran, gran === "hour" ? 24 : 24 * 30, REFRESH_MS);
  const pts = series(data, gran, gran === "hour" ? 24 : 30);
  const max = Math.max(4, ...pts.map((p) => p.clicks));
  const y = (v: number) => H - BOTTOM - (v / max) * (H - TOP - BOTTOM);
  const xs = pts.map((_, i) => PADX + (i * (W - 2 * PADX)) / (pts.length - 1));
  const line = pts.map((p, i) => `${xs[i].toFixed(1)},${y(p.clicks).toFixed(1)}`).join(" ");
  const fmt = (t: number) =>
    new Date(t).toLocaleString(undefined, gran === "hour" ? { hour: "numeric" } : { month: "short", day: "numeric" });
  const peak = Math.max(...pts.map((p) => p.clicks));
  const peakAt = pts.findIndex((p) => p.clicks === peak);
  const STOP_EVERY = 3;
  const ticks = [0, Math.round((pts.length - 1) / 3), Math.round((2 * (pts.length - 1)) / 3), pts.length - 1];
  return (
    <section className="panel chart" aria-label="Clicks over time">
      <div className="chart-top">
        <b>Clicks</b>
        <div className="seg" role="group" aria-label="Range">
          <button aria-pressed={gran === "hour"} onClick={() => setGran("hour")}>24h</button>
          <button aria-pressed={gran === "day"} onClick={() => setGran("day")}>30d</button>
        </div>
      </div>
      {error ? (
        <p className="err">{error}</p>
      ) : (
        <>
          <div className={data && data.total_clicks === 0 ? "chart-empty" : ""}>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Clicks per ${gran}, peak ${max === 4 && !data?.total_clicks ? 0 : Math.max(...pts.map((p) => p.clicks))}`}>
            {[0, 0.5, 1].map((f) => <line key={f} className="g" x1="0" x2={W} y1={y(f * max)} y2={y(f * max)} />)}
            <polygon className="a" points={`${PADX},${H - BOTTOM} ${line} ${W - PADX},${H - BOTTOM}`} />
            <polyline className="ln" points={line} />
            {/* stops along the line, like stations on a route; the busiest point is the big filled stop */}
            {pts.map((p, i) =>
              i % STOP_EVERY === 0 || i === pts.length - 1 ? (
                <circle key={i} className={i === pts.length - 1 ? "stop now" : "stop"} cx={xs[i]} cy={y(p.clicks)} r={i === pts.length - 1 ? 6.5 : 5.5} />
              ) : null,
            )}
            {peak > 0 && <circle className="peak" cx={xs[peakAt]} cy={y(peak)} r="10"><title>{`Busiest: ${peak} clicks`}</title></circle>}
          </svg>
          {data && data.total_clicks === 0 && <p>No clicks in this period yet.</p>}
          </div>
          <div className="axis">{ticks.map((i, k) => <span key={k}>{k === ticks.length - 1 ? (gran === "hour" ? "now" : "today") : fmt(pts[i].t)}</span>)}</div>
        </>
      )}
    </section>
  );
}
