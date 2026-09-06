"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Magic-link sign-in.
 *
 * No password: nothing to leak, reuse, or rotate, and no password reset flow to
 * get wrong. For a single-user terminal the mailbox IS the second factor.
 */
export function LoginForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth/confirm` },
      });
      if (error) setError(error.message);
      else setSent(true);
    });
  }

  if (sent) {
    return (
      <p className="mt-6 border-l-2 border-verdigris pl-3 text-[13px] leading-relaxed text-bone-dim">
        Check your email for a sign-in link. It expires shortly, and it only works for an
        address on the allowlist.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="mt-6">
      <label className="block text-[11.5px] text-bone-faint" htmlFor="email">
        Email
      </label>
      <input
        id="email"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.currentTarget.value)}
        className="mt-1 w-full max-w-[34ch] border-b border-slate-rule bg-transparent pb-1 text-[14px] text-bone focus:border-verdigris focus:outline-none"
      />
      <button
        type="submit"
        disabled={pending || !email}
        className="mt-5 block border border-chalk px-4 py-2 text-[13px] text-chalk transition-colors hover:bg-chalk hover:text-slate-ground disabled:opacity-40"
      >
        {pending ? "Sending…" : "Send sign-in link"}
      </button>
      {error && (
        <p className="mt-3 max-w-[40ch] text-[12.5px] leading-snug text-brick">{error}</p>
      )}
    </form>
  );
}
