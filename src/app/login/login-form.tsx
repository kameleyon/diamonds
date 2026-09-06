"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Password sign-in.
 *
 * Deliberately NOT a magic link, for a reason specific to this deployment:
 * Supabase Auth settings are per-PROJECT, and this project belongs to another
 * live application. Its Site URL, email templates and sender address are that
 * application's. A magic link from here would arrive branded as theirs, from
 * their address, and redirect to their domain -- and fixing that would mean
 * changing settings that their password resets and confirmations depend on.
 *
 * `signInWithPassword` sends no email whatsoever. No template, no sender, no
 * redirect allowlist entry. Nothing in the shared project has to change.
 *
 * There is no sign-up and no reset link here on purpose: the single account is
 * created out of band by `npm run create-owner`, which uses the Admin API and
 * also sends no email.
 */
export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(params.get("error"));
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        // Never distinguish "no such account" from "wrong password": doing so
        // confirms which addresses exist on a project shared with another
        // application's users.
        setError("That email and password combination was not accepted.");
        return;
      }
      const next = params.get("next");
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/board");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="mt-6 max-w-[34ch]">
      <label className="block text-[11.5px] text-bone-faint" htmlFor="email">
        Email
      </label>
      <input
        id="email"
        type="email"
        required
        autoComplete="username"
        value={email}
        onChange={(e) => setEmail(e.currentTarget.value)}
        className="mt-1 w-full border-b border-slate-rule bg-transparent pb-1 text-[14px] text-bone focus:border-verdigris focus:outline-none"
      />

      <label className="mt-5 block text-[11.5px] text-bone-faint" htmlFor="password">
        Password
      </label>
      <input
        id="password"
        type="password"
        required
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.currentTarget.value)}
        className="mt-1 w-full border-b border-slate-rule bg-transparent pb-1 text-[14px] text-bone focus:border-verdigris focus:outline-none"
      />

      <button
        type="submit"
        disabled={pending || !email || !password}
        className="mt-6 block min-h-[46px] w-full border border-chalk px-4 py-2 text-[13px] text-chalk transition-colors hover:bg-chalk hover:text-slate-ground disabled:opacity-40"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>

      {error && <p className="mt-3 text-[12.5px] leading-snug text-brick">{error}</p>}

      <p className="mt-6 text-[11.5px] leading-relaxed text-bone-faint">
        No sign-up and no reset link: this terminal has one account, created from the command
        line. Locked out? Reset the password from the Supabase dashboard.
      </p>
    </form>
  );
}
