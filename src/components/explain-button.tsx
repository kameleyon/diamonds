"use client";

import { useState, useTransition } from "react";
import { explainAction, type ExplainResult } from "@/app/board/actions";
import type { Opportunity } from "@/lib/engine/edge";

/**
 * Ask for a written read on one opportunity.
 *
 * On demand only. Each press is a paid API call, so this never fires
 * automatically and never fans out across the board.
 */
export function ExplainButton({ opportunity }: { opportunity: Opportunity }) {
  const [result, setResult] = useState<ExplainResult | null>(null);
  const [pending, start] = useTransition();

  if (result?.ok) {
    return <RationalePanel result={result} />;
  }

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => start(async () => setResult(await explainAction(opportunity)))}
        disabled={pending}
        className="text-[11px] text-bone-faint hover:text-verdigris disabled:opacity-40"
      >
        {pending ? "reading…" : "explain"}
      </button>
      {result && !result.ok && (
        <p className="mt-1 max-w-[34ch] text-left text-[11px] leading-snug text-brick">
          {result.needsKey
            ? "Add ANTHROPIC_API_KEY in .env.local to get written reads."
            : result.error}
        </p>
      )}
    </div>
  );
}

function RationalePanel({ result }: { result: Extract<ExplainResult, { ok: true }> }) {
  const r = result.rationale;
  const tone =
    r.verdict === "take" ? "text-chalk" : r.verdict === "pass" ? "text-brick" : "text-bone-dim";

  return (
    <div className="mt-2 max-w-[38ch] border-l border-verdigris-dim pl-2.5 text-left">
      <p className={`text-[12px] ${tone}`}>
        {r.verdict} · <span className="text-bone-dim">{r.headline}</span>
      </p>
      <p className="mt-1 text-[11.5px] leading-snug text-bone-dim">{r.reasoning}</p>

      {r.checkBeforeBetting.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {r.checkBeforeBetting.map((c, i) => (
            <li key={i} className="text-[11px] leading-snug text-bone-faint">
              check: {c}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-1.5 text-[11px] text-bone-faint">
        stale-line risk{" "}
        <span className={r.staleLineRisk === "high" ? "text-brick" : "text-bone-dim"}>
          {r.staleLineRisk}
        </span>
      </p>
    </div>
  );
}
