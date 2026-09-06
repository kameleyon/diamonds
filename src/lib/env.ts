/**
 * Environment configuration.
 *
 * Deliberately lazy: reading a missing key throws with an actionable message at
 * the point of use, rather than crashing the whole app at import time. That
 * lets the UI boot and show a setup screen listing exactly what is missing,
 * which is far more useful than a stack trace on a blank page.
 */

export type ServiceKey =
  | "ODDS_API_KEY"
  | "BIGBALLS_API_KEY"
  | "OPENROUTER_API_KEY"
  | "SPORTRADAR_API_KEY"
  | "NEXT_PUBLIC_SUPABASE_URL"
  | "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
  | "DIAMONDS_OWNER_EMAILS"
  | "SUPABASE_URL"
  | "SUPABASE_SECRET_KEY"
  | "DATABASE_URL";

interface ServiceSpec {
  key: ServiceKey;
  label: string;
  /** What breaks without it. */
  purpose: string;
  signupUrl: string;
  required: boolean;
}

export const SERVICES: ServiceSpec[] = [
  {
    key: "ODDS_API_KEY",
    label: "The Odds API",
    purpose: "Live odds and bookmaker lines across all sports. Nothing works without this.",
    signupUrl: "https://the-odds-api.com/",
    required: true,
  },
  {
    key: "BIGBALLS_API_KEY",
    label: "Big Balls Sports Data",
    purpose:
      "Historical results that make the rating models fittable, plus NFL injuries. Its odds are behind the Edge plan, so it does not replace the odds source.",
    signupUrl: "https://bigballsdata.com/dashboard",
    required: false,
  },
  {
    key: "OPENROUTER_API_KEY",
    label: "OpenRouter (Claude Opus 5)",
    purpose:
      "Writes the plain-English rationale for each pick and flags context the price data cannot show (injuries, lineups, weather).",
    signupUrl: "https://openrouter.ai/keys",
    required: false,
  },
  {
    key: "SPORTRADAR_API_KEY",
    label: "Sportradar",
    purpose:
      "Tennis, soccer, NFL and MLB results. The only tennis source available here — Big Balls does not cover tennis at all. No odds on this key.",
    signupUrl: "https://developer.sportradar.com/",
    required: false,
  },
  {
    key: "NEXT_PUBLIC_SUPABASE_URL",
    label: "Supabase URL (browser)",
    purpose:
      "Sign-in. Inlined into the client bundle at BUILD time, so adding it after a deploy has no effect until the next build.",
    signupUrl: "https://supabase.com/dashboard",
    required: false,
  },
  {
    key: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    label: "Supabase publishable key (browser)",
    purpose:
      "Sign-in. Safe to expose — it can do nothing Row Level Security does not permit. Also build-time inlined.",
    signupUrl: "https://supabase.com/dashboard",
    required: false,
  },
  {
    key: "DIAMONDS_OWNER_EMAILS",
    label: "Access allowlist",
    purpose:
      "Comma-separated addresses permitted to use this terminal. Empty means NOBODY is authorised — sign-in will refuse even a valid link.",
    signupUrl: "https://vercel.com/docs/environment-variables",
    required: false,
  },
  {
    key: "SUPABASE_URL",
    label: "Supabase project URL",
    purpose:
      "Postgres storage for the bet log and collected results, in a dedicated `diamonds` schema.",
    signupUrl: "https://supabase.com/dashboard",
    required: false,
  },
  {
    key: "SUPABASE_SECRET_KEY",
    label: "Supabase secret key",
    purpose:
      "Server-side key. The diamonds tables have RLS enabled with no policies, so only this key can reach them — never expose it to a browser.",
    signupUrl: "https://supabase.com/dashboard",
    required: false,
  },
  {
    key: "DATABASE_URL",
    label: "Postgres",
    purpose: "Stores odds history, bet log and closing lines. Required for CLV tracking.",
    signupUrl: "https://vercel.com/marketplace",
    required: false,
  },
];

export function readEnv(key: ServiceKey): string | undefined {
  const v = process.env[key];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

export function requireEnv(key: ServiceKey): string {
  const v = readEnv(key);
  if (!v) {
    const spec = SERVICES.find((s) => s.key === key);
    throw new EnvMissingError(
      `Missing ${key}. ${spec?.purpose ?? ""} Get one at ${spec?.signupUrl ?? "the provider"}, ` +
        `then add ${key}=... to .env.local and restart.`,
      key,
    );
  }
  return v;
}

export class EnvMissingError extends Error {
  constructor(
    message: string,
    public readonly envKey: ServiceKey,
  ) {
    super(message);
    this.name = "EnvMissingError";
  }
}

export interface EnvStatus {
  key: ServiceKey;
  label: string;
  purpose: string;
  signupUrl: string;
  required: boolean;
  present: boolean;
}

/** Snapshot of which integrations are wired. Drives the setup screen. */
export function envStatus(): EnvStatus[] {
  return SERVICES.map((s) => ({ ...s, present: readEnv(s.key) !== undefined }));
}

export function isConfigured(): boolean {
  return SERVICES.filter((s) => s.required).every((s) => readEnv(s.key) !== undefined);
}
