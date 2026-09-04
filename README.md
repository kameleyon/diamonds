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
| `ANTHROPIC_API_KEY` | No | Written reads on individual opportunities. |
| `API_SPORTS_KEY` | No | Richer stats for model fitting. |
| `DATABASE_URL` | No | Not yet used; the ledger is file-backed. |

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
- Parlay EV is `∏(1 + EVᵢ) − 1`. Multiplication magnifies whatever sign you feed it: three legs at +3% compound to +9.3%, three legs at a normal −5% compound to −14.3%. A parlay is only ever correct when every leg is independently +EV.

## Commands

```bash
npm run dev          # dev server
npm test             # 66 tests over the odds maths, models and engine
npm run devig-demo   # how far the four devig methods disagree
npm run build
```

## Storage

The bet log, collected results and fitted ratings live in `.data/` as JSON. That is a deliberate choice for a single-user local tool — one writer, small dataset, no provisioning, works immediately. Writes go through a temp file and a rename so an interrupted write cannot truncate the log. If this ever becomes multi-user, replace `src/lib/db/bet-store.ts`; nothing above it depends on the storage.

## Honest limitations

- **The rating models are not fitted.** They accumulate from live scores over weeks and are useless until they do. The Model tab says exactly how far along each one is.
- **There is no backtest harness yet.** Until there is, model weight should stay at zero.
- **Player props are only available per-event**, which costs credits per fixture. Pull them selectively.
- **MLB team Elo is a weak model** because the starting pitcher dominates a single game. Treat it as a prior, not a forecast.
- **Tennis uses one rating per player**, ignoring surface, which is a known and material simplification.
- **CLV needs 100+ bets** before it means anything, and the t-statistic assumes independent bets, which same-day correlated bets violate.
