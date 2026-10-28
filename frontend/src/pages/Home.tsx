import { useStore } from "../store";

export default function Home() {
  const { setComposer, hasKey, links } = useStore();
  return (
    <div className="empty">
      <div>
        <span className="mark" />
        <h2>{!hasKey ? "Connect your API key" : links.length ? "Pick a link to see its clicks" : "Create your first short link"}</h2>
        <p>{!hasKey ? "Open Settings and paste the key printed by make seed." : "Paste a long URL to get a short one with a QR code and live click counts."}</p>
        {hasKey && <button className="btn primary" style={{ marginTop: 8 }} onClick={() => setComposer(true)}>New link <span className="kbd" style={{ background: "transparent", color: "inherit", borderColor: "currentColor", opacity: .6 }}>N</span></button>}
      </div>
    </div>
  );
}
