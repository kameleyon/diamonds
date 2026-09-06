# Diamonds

A personal betting terminal. It finds prices that are out of line with the sharp market, sizes them, and tracks whether the method actually works.

Covers soccer, NFL, college football, MLB and tennis, across moneyline, totals, spreads and player props.

## What it will and will not do

It will not predict winners better than the market. Nothing does. Bookmaker prices already contain more information than any model you or I can build, and any tool promising otherwise is selling something.

What it does instead is find **positive expected value**: cases where one book's price is out of line with what the sharpest books think, and where betting it is profitable in the long run regardless of whether that particular bet wins.

There are two sources of edge here, and they are kept strictly separate because they deserve very different amounts of trust.

**Market edge** compares the devigged price at a sharp book — Pinnacle by preference, since its line moves on money rather than opinion — against the best price available anywhere. This needs no model, works from the first run, and is how most profitable bettors actually operate. Edges are small (1–4%) and real.

**Model edge** compares your own rating model against the whole market. Potentially much larger, and much more likely to be wrong. The model's weight on the board is **zero by default** and stays there until a backtest earns it.

## Getting started

```bash
npm install
cp .env.example .env.local   # add at least ODDS_API_KEY
npm run dev
```

Then open <http://localhost:3000>. To see the board working before adding any key:

```
http://localhost:3000/board?demo=1
```

Demo mode uses hand-built prices and labels itself as such. It is opt-in only and never substitutes for a failed live fetch — if real data breaks, the board shows the break.

### Keys

| Variable | Required | What it does |
|---|---|---|
| `ODDS_API_KEY` | Yes | Live odds for every sport. Free tier is 500 credits/month. |
| `BIGBALLS_API_KEY` | No | Historical results, which is what makes the models fittable. Free tier is 1,000 requests/day. |
| `ANTHROPIC_API_KEY` | No | Written reads on individual opportunities. |
| `DATABASE_URL` | No | Not yet used; the ledger is file-backed. |

Odds and results come from **different providers on purpose**. Big Balls has the deep result
history the models need but puts bookmaker odds behind its Edge plan; The Odds API has the
prices. Neither alone is enough.

**Pinnacle only exists in the `eu` region.** The `us` region has no Pinnacle, so a US-only scan
falls back to soft-book consensus and every edge is correctly graded low confidence. The default
region set is `["us", "eu"]` for exactly this reason — dropping `eu` to save credits also removes
the sharp anchor the whole engine depends on.

**Credits are the binding constraint.** The Odds API bills `markets × regions` per competition, so three markets across two regions costs six credits per league scanned. Every refresh reports what it spent, and `buildSlate` enforces a credit budget. Keep the sport selection tight.

## The three screens

**Board** — live prices above fair value, ranked by edge. Each row carries its own evidence: which book set the fair line, how many books agreed, and how far the four devig methods disagreed. When that disagreement is wider than the edge, the row says so, because that means the edge is an artefact rather than an opportunity.

**Model** — rating model status per sport, with an honest readout of how far from usable each one is. Ratings accumulate from completed results over weeks.

**Ledger** — every bet, with profit, ROI, and closing line value. CLV leads the page, not profit. Over any sample a personal bettor can realistically reach, profit is mostly variance; beating the closing line is the part that indicates skill. Record the closing price before kickoff — books take the market down once play starts and the number is unrecoverable afterwards.

## How the maths works

`src/lib/odds/` is the foundation and is fully tested.

**Devigging** turns quoted prices into fair probabilities. Four methods are implemented — multiplicative, additive, power and Shin — and the choice is not cosmetic. On a lopsided market they disagree by 1–3 percentage points, which is larger than most real edges, so the method alone can invent or erase one. Shin is the default; `npm run devig-demo` shows how far apart they get on real market shapes.

**Staking** is quarter Kelly with a hard 2% cap. Full Kelly assumes your probability is exactly right, which it never is.

**Shrinkage** blends any model probability toward the market before sizing. Weight starts at zero and has to be earned.

A few properties worth knowing, all asserted in the test suite:

- Power and Shin correct the favourite-longshot bias in a specific direction. Getting the sign backwards is the classic silent bug — it produces plausible, wrong numbers with no visible symptom.
- You can never find an edge by comparing a book against its own devigged line. The vig guarantees `fair × price < 1` for every outcome.
- A book's own market must imply *more* than 100%. Bookmakers always charge margin, so `R < 1` within one book is a broken or empty book, not an arbitrage. Live data produced a 110/110 Betfair market — 1.8% implied total, which normalised to a clean 50/50 and a fictitious **+5400%** edge. Such markets are now rejected before pricing.
- **In-play fixtures are excluded.** Books update at different speeds during a game, so a stale price at one against a live price at another invents huge phantom edges. Live data produced a +213% "edge" on a baseball game that had been running two hours.
- **Confidence falls as the edge grows.** Against a sharp reference, a large gap is evidence of broken data rather than opportunity. Edges above 10% are graded low regardless of how good the evidence otherwise looks.
- Parlay EV is `∏(1 + EVᵢ) − 1`. Multiplication magnifies whatever sign you feed it: three legs at +3% compound to +9.3%, three legs at a normal −5% compound to −14.3%. A parlay is only ever correct when every leg is independently +EV.

## Commands

```bash
npm run dev          # dev server
npm test             # 66 tests over the odds maths, models and engine
npm run backfill     # pull completed results into .data/ (resumable)
npm run fit          # fit the models and print what converged
npm run backtest     # walk-forward test: does any model actually have skill?
npm run devig-demo   # how far the four devig methods disagree
npm run build
```

### Backfilling results

`npm run backfill` walks backwards a day at a time and is safe to re-run — it resumes from a
cursor rather than re-fetching. Three API quirks shape it, all found by probing and all silent
if you get them wrong:

- **`page` is ignored.** Pages 1, 2 and 3 of a query return identical rows, so a loop that pages
  until a short result set spins until it exhausts its budget.
- **`sport` or `league` can degrade the response** to a scores projection with no team names.
  Baseball does this on every query. Omitting both returns full objects for all sports at once,
  which is also ~5× cheaper.
- **Without a date filter the list returns upcoming fixtures**, so a naive backfill collects zero
  finished results and looks like a silent failure rather than a bug.

## Security model

The database is **shared with a separate live application** that owns 33 tables in `public`.
That single fact drives every decision here.

**The `diamonds` schema is not exposed to the Data API.** PostgREST serves only the schemas
listed in the project's API settings, and this is not one of them, so `anon` and `authenticated`
cannot reach these tables through REST at all. Exposing it would be a project-wide change
affecting the other application, so it stays closed.

**Signed in is not the same as allowed in.** Supabase Auth is scoped to the *project*, so users
of the other application can obtain a perfectly valid session here. Access is an explicit
allowlist (`DIAMONDS_OWNER_EMAILS`), checked server-side on every request and again in the
magic-link callback, which signs a non-listed user straight back out. With no allowlist
configured, nobody is authorised — it fails closed.

**Middleware is not the security boundary.** It refreshes the session and redirects browsers,
but Server Actions are callable POST endpoints that middleware never sees. Every action and
every data read calls `requireViewer()` itself.

**The secret key can read everything.** It bypasses RLS and reaches every schema in the project,
including the other application's tables. `src/lib/supabase/admin.ts` opens with
`import "server-only"`, which makes importing it from a Client Component a *build error* rather
than a runtime leak. Because that key bypasses RLS, the `.eq("user_id", …)` filters in
`bet-store-pg.ts` are the only thing enforcing ownership on that path — RLS is defence in depth
there, not the control.

**RLS policies follow the rules that are easy to get wrong**: `TO authenticated` plus an
ownership predicate (the role alone is authentication without authorisation), `USING` *and*
`WITH CHECK` on UPDATE (without the latter a row can be reassigned to another user), and
`auth.uid()` wrapped in a scalar subselect so it evaluates once per statement.

Headers: nonce-based CSP with `strict-dynamic` (so Next's inline hydration scripts run without
`unsafe-inline` permitting injected ones), `frame-ancestors 'none'`, `form-action 'self'`,
HSTS, `nosniff`, and no `X-Powered-By`. Styles keep `unsafe-inline` — Tailwind needs it and
there is no nonce path for style attributes; that is a stated limitation, and style injection is
a far weaker primitive than script injection.

## Storage

Two modes, chosen by configuration and **not a fallback**: with Supabase configured the bet log
lives in `diamonds.bets`, scoped to the signed-in user; without it, in a local JSON file. If
Postgres is configured and a query fails, the app throws rather than quietly writing to the file
— a silent downgrade would split the ledger across two stores, and its whole value depends on
there being exactly one record of what was actually staked.

In local mode the bet log, collected results and fitted ratings live in `.data/` as JSON. That is a deliberate choice for a single-user local tool — one writer, small dataset, no provisioning, works immediately. Writes go through a temp file and a rename so an interrupted write cannot truncate the log. If this ever becomes multi-user, replace `src/lib/db/bet-store.ts`; nothing above it depends on the storage.

## Honest limitations

- **Model quality varies by sport.** Soccer and MLB have enough history to fit; NFL and college football do not yet — run `npm run backfill` again to go further back. The Model tab states where each one stands.
- **Tennis has no results source.** Big Balls does not cover tennis at all, so tennis ratings cannot be fitted from the current providers.
- **Team names are not aliased.** The same club can appear under two spellings ("SV Elversberg" and "SV 07 Elversberg"), splitting its history. Both were excluded as thin here, but a longer backfill will need an alias table.
- **Cup fixtures carry the league label.** Domestic cup matches against lower-division clubs are labelled with the top-flight league, so those clubs would otherwise be fitted as league members. Competitors with fewer than six appearances are dropped before fitting for exactly this reason — without it, Hull City topped the Premier League on a wildly unidentified parameter.
- **The models have no useful skill yet, and this is measured, not assumed.** `npm run backtest` walks forward over the stored results — fitting only on the past, predicting matches the model has never seen — and scores with log loss against a base-rate baseline. Current findings on 3,900 results:

  | Model | n | Skill over base rate |
  |---|---|---|
  | MLB Elo | 2,146 | −0.0% (0.67% once calibrated) |
  | Soccer Elo | 1,293 | 0.2% (0.82% once calibrated) |
  | Dixon-Coles per league | 60–127 | inconclusive, samples far too small |

  Raw Elo was systematically overconfident — it said 72% where 66% happened, and 28% where 34% happened. Shrinking toward a *running* base rate (never the full-sample rate, which would leak the future) cuts calibration error from 3.5% to 0.5% on MLB and turns the skill positive. It is still under 1%, which is not a betting edge. **Model weight stays at zero, now for a measured reason rather than a cautious one.**

  A backtest also cannot tell you whether a model beats the *market* — that needs historical closing odds, which no current data source provides on its plan. Beating a base rate is the floor, not the bar.
- **Player props are only available per-event**, which costs credits per fixture. Pull them selectively.
- **MLB team Elo is a weak model** because the starting pitcher dominates a single game. Treat it as a prior, not a forecast.
- **Tennis uses one rating per player**, ignoring surface, which is a known and material simplification.
- **CLV needs 100+ bets** before it means anything, and the t-statistic assumes independent bets, which same-day correlated bets violate.
