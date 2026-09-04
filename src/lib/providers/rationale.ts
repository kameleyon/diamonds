/**
 * Plain-English rationale for a bet.
 *
 * The division of labour here is deliberate and strictly enforced by the
 * schema: the model NEVER produces a probability, a price, or a stake. Those
 * come from the maths, which is auditable and testable. An LLM asked for a
 * probability will produce a confident number with no calibration behind it,
 * and blending that into the staking calculation would quietly corrupt every
 * downstream figure.
 *
 * What it is genuinely good at is the part the maths cannot do: reading the
 * evidence behind an edge and saying whether it looks like a real overlay or a
 * stale line, and naming the context a price-only model cannot see -- injuries,
 * lineups, rest, weather, motivation.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { requireEnv } from "../env";
import type { Opportunity } from "../engine/edge";
import { pct, signedPct, marketLabel, matchup, kickoff } from "../display";

export const RationaleSchema = z.object({
  verdict: z
    .enum(["take", "caution", "pass"])
    .describe("Whether the evidence behind this edge looks trustworthy enough to act on."),
  headline: z.string().describe("One short sentence, under 15 words, stating the read."),
  reasoning: z
    .string()
    .describe(
      "Two to four sentences explaining what the evidence does and does not support. Reference the actual numbers given.",
    ),
  checkBeforeBetting: z
    .array(z.string())
    .describe(
      "Specific things to verify that price data cannot show: injuries, lineups, rest, weather, travel, motivation. Empty if genuinely none apply.",
    ),
  staleLineRisk: z
    .enum(["low", "medium", "high"])
    .describe(
      "How likely it is that this price is an error or already gone rather than a genuine overlay.",
    ),
});

export type Rationale = z.infer<typeof RationaleSchema>;

const SYSTEM = `You review betting opportunities that have already been priced by a quantitative engine.

The engine has done the maths. It devigged the sharp market to a fair probability, compared it to the best available price, and sized the stake with fractional Kelly. Those numbers are correct and are not yours to revise.

Your job is the part the maths cannot do:
- Judge whether the EVIDENCE behind the edge is trustworthy, given which books priced it and how much the devig methods disagreed.
- Name the specific real-world context that a price-only model cannot see.

Hard rules:
- Never state a probability, a fair price, or a stake. Never suggest the engine's numbers are wrong on their own terms.
- Never claim knowledge of team news, injuries, or form. You do not have current information. Ask the user to check things; do not assert them.
- A large edge against a sharp reference is usually an error, not an opportunity. Say so.
- An edge measured only against soft books is weak evidence regardless of its size.
- "pass" is a normal and useful verdict. Most prices are not bets.

Be concise and concrete. No hedging filler, no betting-tipster tone.`;

function describe(o: Opportunity): string {
  return [
    `Fixture: ${matchup(o.homeTeam, o.awayTeam)} (${o.sportLabel}, ${kickoff(o.commenceTime)})`,
    `Bet: ${o.selection} — ${marketLabel(o.marketKey, o.point)}`,
    `Best price: ${o.bestPrice.toFixed(2)} at ${o.bestBookTitle}`,
    `Fair probability: ${pct(o.fairProbability)} (source: ${o.fairSource}, ${o.booksCounted} book(s))`,
    `Price implies: ${pct(1 / o.bestPrice)}`,
    `Edge: ${signedPct(o.ev)}`,
    `Devig method disagreement on this outcome: ${(o.methodSpread * 100).toFixed(2)} percentage points`,
    `Reference book overround: ${pct(o.overround)}`,
    `Engine confidence in the evidence: ${o.confidence}`,
    o.modelProbability !== undefined
      ? `Rating model says: ${pct(o.modelProbability)} (not yet backtested, treat as weak)`
      : `No rating model covers this market.`,
    o.warnings.length
      ? `Engine warnings:\n${o.warnings.map((w) => `  - ${w}`).join("\n")}`
      : `Engine warnings: none.`,
  ].join("\n");
}

export class RationaleUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RationaleUnavailableError";
  }
}

/**
 * Write the rationale for one opportunity.
 *
 * Effort is deliberately low: this is a short judgement-and-writing task over
 * data that is already computed, not a reasoning problem. Raise it only if the
 * output turns out to be shallow.
 */
export async function explainOpportunity(o: Opportunity): Promise<Rationale> {
  let apiKey: string;
  try {
    apiKey = requireEnv("ANTHROPIC_API_KEY");
  } catch (err) {
    throw new RationaleUnavailableError((err as Error).message);
  }

  const client = new Anthropic({ apiKey });

  const response = await client.messages.parse({
    model: "claude-opus-5",
    // Deliberately short structured output; nothing here needs headroom.
    max_tokens: 2000,
    system: SYSTEM,
    output_config: {
      format: zodOutputFormat(RationaleSchema),
      effort: "low",
    },
    messages: [{ role: "user", content: describe(o) }],
  });

  if (!response.parsed_output) {
    throw new RationaleUnavailableError(
      "The model did not return output matching the expected schema.",
    );
  }

  return response.parsed_output;
}
