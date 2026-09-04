import { envStatus } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function SetupPage() {
  const services = envStatus();
  const missingRequired = services.filter((s) => s.required && !s.present);

  return (
    <div className="mx-auto max-w-[1400px] px-5 py-10">
      <div className="max-w-[68ch]">
        <h1 className="text-[22px] text-bone">Connections</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-bone-dim">
          {missingRequired.length === 0
            ? "Everything the board needs is connected. Optional services below unlock the model and the ledger."
            : "The board needs live prices before it can find anything."}{" "}
          Keys go in <code className="num text-bone">.env.local</code> at the project root, then
          restart the dev server.
        </p>
      </div>

      <ul className="mt-8 max-w-[900px] border-t border-slate-rule">
        {services.map((s) => (
          <li
            key={s.key}
            className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-slate-rule py-4"
          >
            <span
              aria-hidden
              className={`mt-2 h-[7px] w-[7px] shrink-0 rotate-45 ${
                s.present ? "bg-verdigris" : s.required ? "bg-brick" : "bg-slate-rule-strong"
              }`}
            />
            <div className="min-w-[170px]">
              <div className="text-[14px] text-bone">{s.label}</div>
              <div className="num mt-0.5 text-[11.5px] text-bone-faint">{s.key}</div>
            </div>

            <p className="max-w-[52ch] flex-1 text-[12.5px] leading-relaxed text-bone-dim">
              {s.purpose}
            </p>

            <div className="ml-auto text-right">
              <div
                className={`text-[12.5px] ${
                  s.present ? "text-verdigris" : s.required ? "text-brick" : "text-bone-faint"
                }`}
              >
                {s.present ? "Connected" : s.required ? "Required" : "Optional"}
              </div>
              {!s.present && (
                <a
                  href={s.signupUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-0.5 inline-block text-[12px] text-bone-faint underline decoration-slate-rule-strong underline-offset-2 hover:text-bone"
                >
                  Get a key
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>

      <section className="mt-10 max-w-[68ch]">
        <h2 className="text-[15px] text-bone">Spending credits carefully</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-bone-dim">
          The Odds API bills one credit per market per region, so a scan of three markets across
          two regions costs six credits for each competition it touches. The free tier is 500 a
          month. The board caps every refresh at a credit budget and reports what it spent, but
          the practical habit is to keep the sport selection tight and refresh deliberately
          rather than leaving the page open.
        </p>
      </section>
    </div>
  );
}
