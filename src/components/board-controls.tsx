"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { SPORTS, SPORT_IDS, type SportId } from "@/lib/sports/registry";
import type { DevigMethod } from "@/lib/odds/devig";

/**
 * Board controls.
 *
 * Every setting lives in the URL rather than component state, so a
 * configuration can be bookmarked and returned to, and the server re-renders
 * the board with the real numbers instead of recomputing in the browser.
 */
export function BoardControls({
  sports,
  bankroll,
  kelly,
  devig,
  minEv,
}: {
  sports: SportId[];
  bankroll: number;
  kelly: number;
  devig: DevigMethod;
  minEv: number;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function set(patch: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    startTransition(() => router.push(`/board?${next.toString()}`));
  }

  function toggleSport(id: SportId) {
    const next = sports.includes(id) ? sports.filter((s) => s !== id) : [...sports, id];
    set({ sports: next.join(",") });
  }

  return (
    <div className={pending ? "opacity-60 transition-opacity" : "transition-opacity"}>
      <div className="flex flex-wrap items-center gap-x-1 gap-y-2">
        {SPORT_IDS.map((id) => {
          const on = sports.includes(id);
          return (
            <button
              key={id}
              type="button"
              onClick={() => toggleSport(id)}
              aria-pressed={on}
              title={SPORTS[id].caveat}
              className={[
                "border px-2.5 py-1 text-[12.5px] transition-colors",
                on
                  ? "border-verdigris text-bone"
                  : "border-slate-rule text-bone-faint hover:border-slate-rule-strong hover:text-bone-dim",
              ].join(" ")}
            >
              {SPORTS[id].label}
            </button>
          );
        })}

        <div className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-2">
          <Field label="Bankroll">
            <input
              type="number"
              defaultValue={bankroll}
              min={100}
              step={100}
              onBlur={(e) => set({ bankroll: e.currentTarget.value })}
              className="num w-24 border-b border-slate-rule bg-transparent pb-0.5 text-right text-[13px] text-bone focus:border-verdigris focus:outline-none"
              aria-label="Bankroll in dollars"
            />
          </Field>

          <Field label="Kelly">
            <Select
              value={String(kelly)}
              onChange={(v) => set({ kelly: v })}
              options={[
                ["0.125", "Eighth"],
                ["0.25", "Quarter"],
                ["0.5", "Half"],
                ["1", "Full"],
              ]}
            />
          </Field>

          <Field label="Devig">
            <Select
              value={devig}
              onChange={(v) => set({ devig: v })}
              options={[
                ["shin", "Shin"],
                ["power", "Power"],
                ["multiplicative", "Multiplicative"],
                ["additive", "Additive"],
              ]}
            />
          </Field>

          <Field label="Min edge">
            <Select
              value={String(minEv)}
              onChange={(v) => set({ minEv: v })}
              options={[
                ["0.01", "1%"],
                ["0.02", "2%"],
                ["0.03", "3%"],
                ["0.05", "5%"],
              ]}
            />
          </Field>

          <button
            type="button"
            onClick={() => startTransition(() => router.refresh())}
            className="border border-slate-rule px-2.5 py-1 text-[12.5px] text-bone-dim hover:border-verdigris hover:text-bone"
          >
            {pending ? "Reading…" : "Refresh"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2 text-[11.5px] text-bone-faint">
      {label}
      {children}
    </label>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
      className="border-b border-slate-rule bg-transparent pb-0.5 text-[13px] text-bone focus:border-verdigris focus:outline-none"
    >
      {options.map(([v, label]) => (
        <option key={v} value={v} className="bg-slate-raised text-bone">
          {label}
        </option>
      ))}
    </select>
  );
}
