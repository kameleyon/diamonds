/**
 * Cumulative profit after each settled bet.
 *
 * Drawn without axes or gridlines on purpose. The absolute numbers are already
 * stated as figures beside it; what the line is for is shape -- how deep the
 * drawdowns run and how long the flat stretches last. Dressing it up as a
 * proper chart would invite reading precision into a sample that rarely has any.
 */
export function ProfitCurve({ points }: { points: { at: string; profit: number }[] }) {
  if (points.length < 2) return null;

  const w = 260;
  const h = 64;
  const values = points.map((p) => p.profit);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = max - min || 1;

  const x = (i: number) => (i / (points.length - 1)) * w;
  const y = (v: number) => h - ((v - min) / range) * h;

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.profit).toFixed(1)}`).join(" ");
  const last = values[values.length - 1];
  const zeroY = y(0);

  return (
    <figure className="shrink-0">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Cumulative profit across ${points.length} settled bets, currently ${last.toFixed(0)}`}>
        {/* Break-even. The only reference line worth drawing. */}
        <line x1="0" y1={zeroY} x2={w} y2={zeroY} stroke="var(--color-slate-rule-strong)" strokeWidth="1" />
        <path
          d={path}
          fill="none"
          stroke={last >= 0 ? "var(--color-chalk)" : "var(--color-brick)"}
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <circle
          cx={x(points.length - 1)}
          cy={y(last)}
          r="2.5"
          fill={last >= 0 ? "var(--color-chalk)" : "var(--color-brick)"}
        />
      </svg>
      <figcaption className="mt-1 text-[11px] text-bone-faint">
        profit across {points.length} settled bets
      </figcaption>
    </figure>
  );
}
