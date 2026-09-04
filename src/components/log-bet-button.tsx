"use client";

import { useState, useTransition } from "react";
import { logBetAction } from "@/app/ledger/actions";
import type { Opportunity } from "@/lib/engine/edge";
import { matchup } from "@/lib/display";

/**
 * Log a bet straight off the board.
 *
 * Captures the fair probability and edge AS THEY WERE when the bet went on.
 * Recomputing those later from a moved line would quietly rewrite history and
 * make the ledger useless for judging the method.
 */
export function LogBetButton({ opportunity }: { opportunity: Opportunity }) {
  const [state, setState] = useState<"idle" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();

  function log() {
    start(async () => {
      const result = await logBetAction({
        eventId: opportunity.eventId,
        sportKey: opportunity.sportKey,
        sportLabel: opportunity.sportLabel,
        fixture: matchup(opportunity.homeTeam, opportunity.awayTeam),
        commenceTime: opportunity.commenceTime,
        marketKey: opportunity.marketKey,
        selection: opportunity.selection,
        point: opportunity.point,
        book: opportunity.bestBookTitle,
        odds: opportunity.bestPrice,
        stake: Number(opportunity.stake.amount.toFixed(2)),
        fairAtBet: opportunity.fairProbability,
        evAtBet: opportunity.ev,
      });

      if (result.ok) {
        setState("done");
      } else {
        setState("error");
        setMessage(result.error);
      }
    });
  }

  if (state === "done") {
    return <span className="mt-1.5 block text-[11px] text-verdigris">logged</span>;
  }

  return (
    <>
      <button
        type="button"
        onClick={log}
        disabled={pending || opportunity.stake.amount <= 0}
        className="mt-1.5 text-[11px] text-bone-faint hover:text-chalk disabled:opacity-40"
      >
        {pending ? "logging…" : "log bet"}
      </button>
      {state === "error" && <span className="block text-[11px] text-brick">{message}</span>}
    </>
  );
}
