/**
 * The value ladder, redrawn phone-native.
 *
 * Same idea as the desktop ladder and the same underlying math, but given the
 * full width of a card instead of a 178px table cell. At that size the two
 * marks can carry their own labels -- the price and the book on the left, the
 * fair probability and its source on the right -- so the row explains itself
 * without a legend lookup.
 *
 * Reading it: the verdigris tick is what the sharp market says the outcome is
 * worth; the chalk diamond is what the offered price needs it to be worth. The
 * chalk between them is the edge. That gap IS the bet.
 */

export function PriceTrack({
  fair,
  offeredImplied,
  price,
  book,
  fairSource,
  muted = false,
}: {
  fair: number;
  offeredImplied: number;
  price: number;
  book: string;
  fairSource: string;
  /** Dim the whole track when the edge is not to be trusted. */
  muted?: boolean;
}) {
  const gap = fair - offeredImplied;

  // Scale adapts to the gap so a 1% edge is still legible, but never zooms so
  // far that a trivial edge fills the card and looks dramatic.
  const halfRange = Math.max(0.05, Math.abs(gap) * 2.2);
  const centre = (fair + offeredImplied) / 2;
  const pos = (p: number) => ((p - (centre - halfRange)) / (halfRange * 2)) * 100;

  const fairX = Math.min(94, Math.max(6, pos(fair)));
  const offerX = Math.min(94, Math.max(6, pos(offeredImplied)));
  const left = Math.min(fairX, offerX);
  const width = Math.abs(fairX - offerX);

  const chalk = muted ? "var(--color-chalk-dim)" : "var(--color-chalk)";

  return (
    <div
      className="relative mt-4 h-[34px]"
      style={muted ? { opacity: 0.55 } : undefined}
      role="img"
      aria-label={`${book} offers ${price.toFixed(2)}, needing ${(offeredImplied * 100).toFixed(1)} percent. ${fairSource} fair value is ${(fair * 100).toFixed(1)} percent. Edge ${(gap * 100).toFixed(1)} points.`}
    >
      {/* Track */}
      <span
        aria-hidden
        className="absolute left-0 right-0 top-[17px] h-px bg-slate-rule-strong"
      />

      {/* The gap. This is the bet. */}
      <span
        aria-hidden
        className="absolute top-[15px] h-[5px]"
        style={{ left: `${left}%`, width: `${width}%`, background: chalk }}
      />

      {/* What the sharp market thinks it is worth. */}
      <span
        aria-hidden
        className="absolute top-[9px] h-[17px] w-px bg-verdigris"
        style={{ left: `${fairX}%` }}
      />

      {/* What the offered price needs it to be worth. */}
      <span
        aria-hidden
        className="absolute top-[13px] h-[9px] w-[9px] -ml-[4.5px] rotate-45"
        style={{ left: `${offerX}%`, background: chalk }}
      />

      {/* Labels ride with their marks, flipping side near the edges so they
          never run off the card. */}
      <TrackLabel x={offerX} top value={price.toFixed(2)} color={chalk} />
      <TrackLabel
        x={fairX}
        top
        value={`${(fair * 100).toFixed(1)}%`}
        color="var(--color-verdigris)"
      />
      <TrackLabel x={offerX} value={book} color="var(--color-bone-faint)" small />
      <TrackLabel x={fairX} value={fairSource} color="var(--color-bone-faint)" small />
    </div>
  );
}

function TrackLabel({
  x,
  value,
  color,
  top = false,
  small = false,
}: {
  x: number;
  value: string;
  color: string;
  top?: boolean;
  small?: boolean;
}) {
  // Past the midpoint the label sits left of its mark; before it, right. Fixed
  // offsets would collide with the card edge on lopsided markets.
  const flip = x > 50;
  return (
    <span
      aria-hidden
      className={`num absolute whitespace-nowrap ${top ? "top-0" : "bottom-0"}`}
      style={{
        left: `${x}%`,
        color,
        fontSize: small ? "10px" : "10.5px",
        transform: flip ? "translateX(-100%)" : "none",
        marginLeft: flip ? "-6px" : "6px",
        fontFamily: small ? "var(--font-sans)" : "var(--font-mono)",
      }}
    >
      {value}
    </span>
  );
}
