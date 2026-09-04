/**
 * The value ladder.
 *
 * One row's edge, drawn rather than asserted. The track is a probability scale
 * centred between two marks:
 *
 *   - the verdigris tick is what the sharp market says the outcome is worth
 *   - the chalk dot is what the offered price needs it to be worth
 *
 * When the dot sits left of the tick, the book is asking for a lower
 * probability than the market believes, and the chalk-filled gap between them
 * is the edge. Seeing the gap makes the size of the claim immediate in a way a
 * percentage in a column never does.
 */

export function ValueLadder({
  fair,
  offeredImplied,
  className = "",
}: {
  /** Sharp-consensus fair probability. */
  fair: number;
  /** Probability implied by the price on offer (1 / decimal odds). */
  offeredImplied: number;
  className?: string;
}) {
  const gap = fair - offeredImplied;

  // Scale adapts to the gap so small edges stay visible, but never zooms in so
  // far that a trivial edge looks dramatic.
  const halfRange = Math.max(0.05, Math.abs(gap) * 2.2);
  const centre = (fair + offeredImplied) / 2;
  const pos = (p: number) => ((p - (centre - halfRange)) / (halfRange * 2)) * 100;

  const fairX = Math.min(98, Math.max(2, pos(fair)));
  const offeredX = Math.min(98, Math.max(2, pos(offeredImplied)));
  const left = Math.min(fairX, offeredX);
  const width = Math.abs(fairX - offeredX);
  const positive = gap > 0;

  return (
    <div
      className={`relative h-[20px] w-full min-w-[120px] ${className}`}
      role="img"
      aria-label={
        positive
          ? `Market fair value ${(fair * 100).toFixed(1)} percent against ${(offeredImplied * 100).toFixed(1)} percent implied by the price, an edge of ${(gap * 100).toFixed(1)} points`
          : `No edge: price implies ${(offeredImplied * 100).toFixed(1)} percent against fair value ${(fair * 100).toFixed(1)} percent`
      }
    >
      {/* Track */}
      <span
        aria-hidden
        className="absolute top-1/2 left-0 h-px w-full -translate-y-1/2 bg-slate-rule-strong"
      />

      {/* The gap. This is the bet. */}
      <span
        aria-hidden
        className={`absolute top-1/2 h-[4px] -translate-y-1/2 ${
          positive ? "bg-chalk" : "bg-brick-dim"
        }`}
        style={{ left: `${left}%`, width: `${width}%` }}
      />

      {/* What the market thinks it is worth. */}
      <span
        aria-hidden
        className="absolute top-1/2 h-[13px] w-px -translate-x-1/2 -translate-y-1/2 bg-verdigris"
        style={{ left: `${fairX}%` }}
      />

      {/* What the price needs it to be worth. */}
      <span
        aria-hidden
        className={`absolute top-1/2 h-[8px] w-[8px] -translate-x-1/2 -translate-y-1/2 rotate-45 ${
          positive ? "bg-chalk" : "bg-brick"
        }`}
        style={{ left: `${offeredX}%` }}
      />
    </div>
  );
}

/** Legend for the ladder, shown once above the board rather than per row. */
export function LadderLegend() {
  return (
    <div className="flex items-center gap-4 text-[11.5px] text-bone-faint">
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="inline-block h-[11px] w-px bg-verdigris" />
        sharp fair value
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="inline-block h-[7px] w-[7px] rotate-45 bg-chalk" />
        price on offer
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="inline-block h-[3px] w-4 bg-chalk" />
        your edge
      </span>
    </div>
  );
}
