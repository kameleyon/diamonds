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
 *
 * PROVIDER NOTE: this calls Claude through OpenRouter rather than the Anthropic
 * SDK directly, because that is the gateway the user chose. OpenRouter exposes
 * an OpenAI-compatible REST surface, so this is a plain fetch against their
 * documented contract -- not an OpenAI shim standing in for the Anthropic SDK.
 * To move to the first-party API later, swap this one function for
 * `client.messages.parse()`; nothing above it changes.
 */

import { z } from "zod";
import { readEnv } from "../env";
import type { Opportunity } from "../engine/edge";
import { pct, signedPct, marketLabel, matchup, kickoff } from "../display";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "anthropic/claude-opus-5";

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
 * Uses a strict JSON schema so the response is machine-checkable rather than
 * prose we have to parse hopefully. The schema is still re-validated with Zod
 * after the fact: `strict` constrains generation, it does not remove the need
 * to verify what actually came back.
 */
export async function explainOpportunity(o: Opportunity): Promise<Rationale> {
  const apiKey = readEnv("OPENROUTER_API_KEY");
  if (!apiKey) {
    throw new RationaleUnavailableError(
      "Missing OPENROUTER_API_KEY. Add it to .env.local to get written reads.",
    );
  }

  const jsonSchema = z.toJSONSchema(RationaleSchema, { io: "output" });

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      // OpenRouter attributes traffic with these; harmless locally, useful later.
      "X-Title": "Diamonds",
    },
    body: JSON.stringify({
      model: MODEL,
      // Deliberately short structured output; nothing here needs headroom.
      max_tokens: 1200,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: describe(o) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "rationale", strict: true, schema: jsonSchema },
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new RationaleUnavailableError(
      `OpenRouter returned ${res.status}: ${body.slice(0, 200)}`,
    );
  }

  const payload = (await res.json()) as {
    error?: { message?: string };
    choices?: { message?: { content?: string } }[];
  };

  if (payload.error) {
    throw new RationaleUnavailableError(payload.error.message ?? "OpenRouter returned an error.");
  }

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new RationaleUnavailableError("OpenRouter returned no content.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new RationaleUnavailableError("The model did not return valid JSON.");
  }

  const result = RationaleSchema.safeParse(parsed);
  if (!result.success) {
    throw new RationaleUnavailableError(
      `The model's output did not match the expected shape: ${result.error.issues[0]?.message ?? "unknown"}`,
    );
  }

  return result.data;
}
