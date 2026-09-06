/**
 * Create (or repoint) the single owner account.
 *
 * Run: npm run create-owner -- --email you@example.com --password '...'
 *
 * Uses the Admin API with the secret key, which creates the user directly and
 * SENDS NO EMAIL. That matters here: this Supabase project is shared with
 * another live application, and its email templates, sender address and Site
 * URL belong to that application. A normal `signUp` would send a confirmation
 * mail branded as theirs, from their address, pointing at their domain.
 *
 * `email_confirm: true` marks the address verified without dispatching
 * anything, so nothing in the shared project's configuration is touched.
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", quiet: true });

import { createClient } from "@supabase/supabase-js";
import { isAllowed, ownerEmails } from "../src/lib/auth-policy";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) {
    console.error("SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env.local.");
    process.exit(1);
  }

  const email = arg("email") ?? ownerEmails()[0];
  const password = arg("password");

  if (!email) {
    console.error("No email given and DIAMONDS_OWNER_EMAILS is empty.");
    process.exit(1);
  }
  if (!password || password.length < 12) {
    console.error("Pass --password with at least 12 characters.");
    process.exit(1);
  }

  // Creating an account the allowlist will refuse is a guaranteed lockout, so
  // catch it here rather than after the fact.
  if (!isAllowed(email)) {
    console.error(
      `${email} is not in DIAMONDS_OWNER_EMAILS, so it could sign in and still be refused.\n` +
        `Add it to the allowlist first (locally AND on Vercel).`,
    );
    process.exit(1);
  }

  const admin = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // The account may already exist -- from a previous run, or because this
  // address belongs to a user of the other application on this project.
  const { data: list, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) {
    console.error(`Could not list users: ${listErr.message}`);
    process.exit(1);
  }

  const existing = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());

  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, { password });
    if (error) {
      console.error(`Could not set the password: ${error.message}`);
      process.exit(1);
    }
    console.log(`\nPassword updated for the existing account ${email}.`);
    console.log(`(That account already existed on this project — nothing else about it changed.)\n`);
    return;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    // Verified without sending anything.
    email_confirm: true,
  });

  if (error) {
    console.error(`Could not create the account: ${error.message}`);
    process.exit(1);
  }

  console.log(`\nCreated ${email} (${data.user?.id}).`);
  console.log(`No email was sent — the shared project's templates and sender are untouched.\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
