"use server";

import { explainOpportunity, RationaleUnavailableError, type Rationale } from "@/lib/providers/rationale";
import type { Opportunity } from "@/lib/engine/edge";

export type ExplainResult =
  | { ok: true; rationale: Rationale }
  | { ok: false; error: string; needsKey: boolean };

/**
 * Explain one opportunity.
 *
 * Called only when the user asks for a specific row. Never fanned out across a
 * slate: each call costs real money, and a board-wide auto-explain would spend
 * meaningfully on rows nobody was going to bet.
 */
export async function explainAction(opportunity: Opportunity): Promise<ExplainResult> {
  try {
    return { ok: true, rationale: await explainOpportunity(opportunity) };
  } catch (err) {
    return {
      ok: false,
      error: (err as Error).message,
      needsKey: err instanceof RationaleUnavailableError,
    };
  }
}
