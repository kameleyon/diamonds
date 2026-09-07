"use client";

import { useState, useTransition } from "react";
import { checkBetAction, checkSlipImageAction } from "./actions";
import type { BetCheck } from "@/lib/engine/check-bet";
import { describeParsedBet } from "@/lib/parse/bet-slip";
import { pct, signedPct } from "@/lib/display";

const EXAMPLES = ["Chiefs ML 2u", "Under 8.5 Dodgers", "Rams -3.5 0.5u"];

export function CheckForm({ demo = false }: { demo?: boolean }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<BetCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [pending, start] = useTransition();

  /**
   * Screenshot path. The image is transcribed to the same shorthand a person
   * would type, then priced by the same code — so an image and typed text
   * saying the same thing cannot disagree.
   */
  function handleFile(file: File | undefined | null) {
    if (!file) return;
    setError(null);
    setReading(true);
    const body = new FormData();
    body.set("slip", file);
    start(async () => {
      const r = await checkSlipImageAction(body, demo);
      setReading(false);
      if (r.ok) {
        setText(r.transcribed);
        setResult(r.check);
      } else {
        setError(r.error);
        setResult(null);
      }
    });
  }

  function submit(e: { preventDefault: () => void }) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await checkBetAction(text, demo);
      if (r.ok) {
        setResult(r.check);
      } else {
        setError(r.error);
        setResult(null);
      }
    });
  }

  return (
    <div>
      <form onSubmit={submit}>
        <div className="flex flex-col gap-2.5 sm:flex-row">
          <input
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            placeholder="Alabama o3.5 1U"
            aria-label="Paste a bet"
            className="num min-h-[56px] flex-1 border border-slate-rule-strong bg-bone/[0.02] px-4 text-[16px] text-bone placeholder:text-bone-faint focus:border-verdigris focus:outline-none"
          />
          <button
            type="submit"
            disabled={pending || !text.trim()}
            className="min-h-[56px] border border-chalk bg-chalk px-7 text-[14px] font-medium text-slate-ground transition-opacity disabled:opacity-40"
          >
            {reading ? "Reading slip…" : pending ? "Pricing…" : "Check it"}
          </button>
        </div>

        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleFile(e.dataTransfer.files?.[0]);
          }}
          className="mt-2.5 flex min-h-[46px] cursor-pointer items-center justify-center gap-2 border border-dashed border-slate-rule-strong px-4 text-[12.5px] text-bone-faint transition-colors hover:border-verdigris hover:text-bone-dim"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          Drop a screenshot of the slip, or tap to choose one
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="sr-only"
            onChange={(e) => handleFile(e.currentTarget.files?.[0])}
          />
        </label>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-bone-faint">
          <span>Try</span>
          {EXAMPLES.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setText(e)}
              className="num text-bone-dim underline decoration-slate-rule-strong underline-offset-2 hover:text-bone"
            >
              {e}
            </button>
          ))}
        </div>
      </form>

      {error && <p className="mt-4 text-[13px] text-brick">{error}</p>}
      {result && <Result check={result} />}
    </div>
  );
}

function Result({ check }: { check: BetCheck }) {
  const tone =
    check.verdict === "take"
      ? "text-chalk"
      : check.verdict === "pass"
        ? "text-brick"
        : "text-bone-dim";

  const word =
    check.verdict === "take"
      ? "Take it"
      : check.verdict === "thin"
        ? "Thin"
        : check.verdict === "pass"
          ? "Pass"
          : "—";

  return (
    <section className="mt-8 border-t border-slate-rule pt-6">
      {/* What was READ, before what was DECIDED. A misparse must be visible
          rather than buried under a confident verdict. */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-slate-rule pb-3">
        <span className="num text-[14px] text-bone-faint">{check.parsed.raw}</span>
        <span className="text-[12px] text-bone-faint">read as</span>
        <span className="text-[14px] text-bone">{describeParsedBet(check.parsed)}</span>
      </div>

      {check.parsed.ambiguities.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {check.parsed.ambiguities.map((a, i) => (
            <li key={i} className="border-l-2 border-slate-rule-strong pl-3 text-[12.5px] leading-relaxed text-bone-dim">
              {a}
            </li>
          ))}
        </ul>
      )}

      {check.settled ? (
        <SettledResult check={check} />
      ) : (
        <div className="mt-6 flex flex-col gap-8 md:flex-row">
          <div className="md:w-[300px] md:shrink-0">
            <p className="num text-[10px] tracking-[0.18em] text-bone-faint">VERDICT</p>
            <p className={`mt-2.5 text-[46px] leading-[0.92] ${tone}`}>{word}</p>
            {check.ev !== undefined && (
              <>
                <p className={`num mt-4 text-[24px] ${tone}`}>{signedPct(check.ev)}</p>
                <p className="mt-1 text-[12.5px] text-bone-faint">
                  expected return per unit staked
                </p>
              </>
            )}

            {check.yourPrice !== undefined && (
              <dl className="mt-6 border-t border-slate-rule pt-4">
                <Row label="Your price" value={check.yourPrice.toFixed(2)} />
                <Row label="Needs to hit" value={pct(check.needsToHit!)} />
                <Row
                  label="Sharp market says"
                  value={pct(check.fairProbability!)}
                  tone="verdigris"
                />
                {check.bestPrice !== undefined && (
                  <Row
                    label="Best price anywhere"
                    value={`${check.bestPrice.toFixed(2)} ${check.bestBook ?? ""}`}
                  />
                )}
              </dl>
            )}
          </div>

          <div className="flex-1">
            <p className="text-[15px] leading-relaxed text-bone">{check.headline}</p>
            {check.reasoning.map((r, i) => (
              <p key={i} className="mt-3 text-[13.5px] leading-relaxed text-bone-dim">
                {r}
              </p>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function SettledResult({ check }: { check: BetCheck }) {
  const s = check.settled!;
  return (
    <div className="mt-6">
      {/*
        Two independent answers, equal weight. Reporting only the result teaches
        that winning bets were good bets -- the most expensive lesson to learn
        wrong.
      */}
      <div className="flex flex-col border border-slate-rule sm:flex-row">
        <div className="flex-1 border-b border-slate-rule p-6 sm:border-b-0 sm:border-r">
          <p className="num text-[10px] tracking-[0.18em] text-bone-faint">RESULT</p>
          <p className={`mt-2.5 text-[40px] leading-[0.95] ${s.won ? "text-chalk" : "text-brick"}`}>
            {s.won ? "Won" : "Lost"}
          </p>
          <p className="num mt-2.5 text-[13px] text-bone-dim">
            {s.homeScore}–{s.awayScore} · {s.fixture}
          </p>
        </div>
        <div className="flex-1 p-6">
          <p className="num text-[10px] tracking-[0.18em] text-bone-faint">
            WAS IT A GOOD BET?
          </p>
          <p className="mt-2.5 text-[40px] leading-[0.95] text-bone-faint">
            {s.wasGoodBet === null ? "Unknown" : s.wasGoodBet ? "Yes" : "No"}
          </p>
          <p className="mt-2.5 text-[13px] leading-relaxed text-bone-dim">
            {s.wasGoodBet === null
              ? "Needs the price you took."
              : s.wasGoodBet
                ? "It was +EV when you placed it."
                : "It was −EV when you placed it."}
          </p>
        </div>
      </div>

      {check.reasoning.map((r, i) => (
        <p key={i} className="mt-3 max-w-[76ch] text-[13.5px] leading-relaxed text-bone-dim">
          {r}
        </p>
      ))}

      <p className="mt-4 max-w-[76ch] border-l-2 border-chalk bg-chalk/[0.04] py-3 pl-3 text-[13px] leading-relaxed text-bone-dim">
        Results move you between winning and losing; only the price you took decides whether the
        bet was right. A bet can be correct and lose, and wrong and win.
      </p>
    </div>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "verdigris";
}) {
  return (
    <div className="mt-2 flex items-baseline text-[13px] first:mt-0">
      <dt className="text-bone-dim">{label}</dt>
      <dd className={`num ml-auto ${tone === "verdigris" ? "text-verdigris" : "text-bone"}`}>
        {value}
      </dd>
    </div>
  );
}
