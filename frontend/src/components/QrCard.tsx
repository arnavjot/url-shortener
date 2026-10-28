import { useRef } from "react";
import { QRCodeCanvas } from "qrcode.react";

export default function QrCard({ value, name }: { value: string; name: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  function download() {
    const canvas = wrap.current?.querySelector("canvas");
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `${name}-qr.png`;
    a.click();
  }
  return (
    <div className="panel qrbox">
      {/* always on white so phones can scan it in dark mode */}
      <div ref={wrap} className="qr">
        <QRCodeCanvas value={value} size={176} marginSize={0} level="M" style={{ width: "100%", height: "auto", maxWidth: 176 }} />
      </div>
      <button type="button" className="btn" onClick={download}>Download PNG</button>
    </div>
  );
}
