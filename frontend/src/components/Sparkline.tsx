export default function Sparkline({ values, width = 56, height = 18 }: { values: number[]; width?: number; height?: number }) {
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${((i * width) / (values.length - 1 || 1)).toFixed(1)},${(height - 1 - (v / max) * (height - 3)).toFixed(1)}`).join(" ");
  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
      <polyline points={pts} />
    </svg>
  );
}
