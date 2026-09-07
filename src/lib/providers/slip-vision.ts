import "server-only";

/**
 * Read a bet slip from a screenshot.
 *
 * The model's job here is deliberately narrow: TRANSCRIBE, do not judge. It
 * returns the slip as the same shorthand a person would type, and that string
 * goes through exactly the same parser as typed input.
 *
 * That single-path design matters. If vision produced its own structured bet
 * object, there would be two independent interpretations of what a bet is, and
 * they would drift — an image and a typed slip saying the same thing could get
 * different verdicts. Funnelling both through one parser makes that impossible,
 * and means every ambiguity the parser flags gets flagged for images too.
 *
 * The model is also explicitly told not to price the bet. Its opinion on
 * whether a bet is good would be an uncalibrated guess competing with the
 * engine's audited one.
 */

import { readEnv } from "../env";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "anthropic/claude-opus-5";

/** Anything larger is a photo of a screen, not a screenshot; refuse early. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

const SYSTEM = `You transcribe betting slips from screenshots.

Return ONLY the bet, written the way a bettor would type it in shorthand:
  <team or player> <market> <line if any> <price if shown> <stake if shown>

Examples of correct output:
  Alabama o3.5 1u
  Kansas City Chiefs ML -130 2u
  Under 8.5 Dodgers -110
  Rams -3.5 $50

Rules:
- Output one line of shorthand and nothing else. No explanation, no punctuation
  around it, no markdown.
- Use the team or player name exactly as the slip shows it.
- Include the price only if the slip shows one. Never invent or estimate a price.
- Include the stake only if the slip shows one.
- If the image contains several bets, transcribe only the first.
- If you cannot read a bet in the image, output exactly: UNREADABLE
- Do NOT say whether the bet is good, likely to win, or worth taking. You are
  transcribing, not advising.`;

export class SlipVisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SlipVisionError";
  }
}

/**
 * Transcribe a slip image into the shorthand the parser understands.
 *
 * Returns null when the model could not read a bet — an honest miss, which the
 * caller surfaces rather than turning into a guess.
 */
export async function readSlipImage(
  base64: string,
  mimeType: string,
): Promise<string | null> {
  const apiKey = readEnv("OPENROUTER_API_KEY");
  if (!apiKey) {
    throw new SlipVisionError(
      "Reading slip images needs OPENROUTER_API_KEY. Type the bet instead, or add the key in .env.local.",
    );
  }
  if (!ACCEPTED_TYPES.includes(mimeType)) {
    throw new SlipVisionError(`Unsupported image type: ${mimeType}.`);
  }

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "Diamonds",
    },
    body: JSON.stringify({
      model: MODEL,
      // One short line of shorthand needs almost nothing.
      max_tokens: 100,
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: [
            { type: "text", text: "Transcribe the bet in this slip." },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new SlipVisionError(`Could not read the image (${res.status}): ${body.slice(0, 160)}`);
  }

  const payload = (await res.json()) as {
    error?: { message?: string };
    choices?: { message?: { content?: string } }[];
  };
  if (payload.error) throw new SlipVisionError(payload.error.message ?? "Vision request failed.");

  const text = payload.choices?.[0]?.message?.content?.trim();
  if (!text || text.toUpperCase().includes("UNREADABLE")) return null;

  // Defend against a chatty answer despite the instructions: take the first
  // line and cap it, so a paragraph can never reach the parser as a "bet".
  const firstLine = text.split("\n")[0].trim().slice(0, 120);
  return firstLine.length > 0 ? firstLine : null;
}
