import { refitAll, type ModelState } from "@/lib/models/fit-from-scores";
import { SPORTS, type SportId } from "@/lib/sports/registry";
import { strengthTable } from "@/lib/models/dixon-coles";

export const dynamic = "force-dynamic";

export default async function ModelPage() {
  const states = await refitAll();
  const anyFitted = states.some((s) => s.readiness !== "unfitted");

  return (
    <div className="mx-auto max-w-[1400px] px-5 py-6">
      <div className="max-w-[76ch]">
        <h1 className="text-[13px] text-bone-faint">Rating models</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-bone">
          The board finds edges without any model at all, by comparing sharp prices against soft
          ones. These models are the second, harder source of edge — and they are worth nothing
          until a backtest says otherwise.
        </p>
        <p className="mt-3 text-[13px] leading-relaxed text-bone-dim">
          Model weight on the board stays at zero by design. Raising it means betting your own
          forecast against a market that aggregates far more information than you do, which is
          only defensible once these ratings have been fitted on real history and tested against
          results they never saw.
        </p>
      </div>

      <div className="mt-8 space-y-px">
        {states.map((s) => (
          <ModelRow key={s.sportId} state={s} />
        ))}
      </div>

      {!anyFitted && (
        <p className="mt-6 max-w-[76ch] border-l-2 border-slate-rule-strong pl-3 text-[13px] leading-relaxed text-bone-dim">
          Nothing is fitted yet because no completed results have been collected. Results
          accumulate each time the board reads live scores, so this fills in over weeks rather
          than at once. Until then the board runs on market edge alone, which is the mode it is
          designed to be useful in.
        </p>
      )}
    </div>
  );
}

function ModelRow({ state }: { state: ModelState }) {
  const spec = SPORTS[state.sportId as SportId];

  return (
    <section className="border-b border-slate-rule py-5">
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
        <h2 className="min-w-[130px] text-[15px] text-bone">{state.label}</h2>

        <ReadinessMark readiness={state.readiness} />

        <div className="flex flex-wrap gap-x-7 gap-y-1 text-[11.5px] text-bone-faint">
          <span>
            {state.kind === "dixon-coles" ? "Dixon-Coles Poisson" : "Elo"}
            {state.kind === "elo" && (
              <>
                {" "}
                <span className="num text-bone-dim">K={spec.eloK}</span>
                {spec.homeAdvantage > 0 && (
                  <>
                    {" "}
                    <span className="num text-bone-dim">HA={spec.homeAdvantage}</span>
                  </>
                )}
              </>
            )}
          </span>
          <span>
            <span className="num text-bone-dim">{state.resultCount}</span> results
          </span>
          <span>
            <span className="num text-bone-dim">{state.competitorCount}</span>{" "}
            {state.sportId === "tennis" ? "players" : "teams"}
          </span>
        </div>
      </div>

      <p className="mt-2 max-w-[80ch] text-[12.5px] leading-relaxed text-bone-dim">
        {state.requirement}
      </p>

      {/* The caveat is permanent and structural, not a status message: it is
          true even when the model is fully fitted. */}
      <p className="mt-1.5 max-w-[80ch] text-[12.5px] leading-relaxed text-bone-faint">
        {spec.caveat}
      </p>

      {state.ratings && state.ratings.length > 0 && (
        <ol className="mt-3 flex flex-wrap gap-x-6 gap-y-1">
          {state.ratings.slice(0, 8).map((r) => (
            <li key={r.competitorId} className="text-[12px] text-bone-dim">
              {r.competitorId}{" "}
              <span className="num text-bone">{Math.round(r.rating)}</span>
            </li>
          ))}
        </ol>
      )}

      {state.poisson && (
        <div className="mt-3">
          <p className="text-[11.5px] text-bone-faint">
            home advantage{" "}
            <span className="num text-bone-dim">{state.poisson.homeAdvantage.toFixed(3)}</span> ·
            low-score correction{" "}
            <span className="num text-bone-dim">{state.poisson.rho.toFixed(3)}</span> ·{" "}
            {state.poisson.converged ? "converged" : "did not converge"}
          </p>
          <ol className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
            {strengthTable(state.poisson)
              .slice(0, 8)
              .map((t) => (
                <li key={t.team} className="text-[12px] text-bone-dim">
                  {t.team}{" "}
                  <span className="num text-bone">
                    {t.net > 0 ? "+" : ""}
                    {t.net.toFixed(2)}
                  </span>
                </li>
              ))}
          </ol>
        </div>
      )}
    </section>
  );
}

function ReadinessMark({ readiness }: { readiness: ModelState["readiness"] }) {
  const label =
    readiness === "usable" ? "Fitted" : readiness === "thin" ? "Too thin to use" : "Not fitted";
  const color =
    readiness === "usable" ? "text-verdigris" : readiness === "thin" ? "text-chalk-dim" : "text-bone-faint";
  return <span className={`text-[12px] ${color}`}>{label}</span>;
}


