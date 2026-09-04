/**
 * Demo slate.
 *
 * A hand-built set of events used to exercise the board without spending API
 * credits. It is NOT a fallback: nothing reads it unless `?demo=1` is passed
 * explicitly, and the board labels itself loudly when it does. Real data
 * failing must look like a failure, never like a quiet substitution.
 *
 * The prices are constructed so the board has something to say: a couple of
 * genuine soft-book overlays, one market with no sharp reference, one
 * implausibly large edge that should be flagged rather than celebrated, and
 * several fixtures where every book agrees and nothing should appear at all.
 */

import type { OddsApiEvent, OddsApiBookmaker } from "../providers/oddsapi";

function hoursFromNow(h: number): string {
  return new Date(Date.now() + h * 3_600_000).toISOString();
}

function bk(
  key: string,
  title: string,
  markets: { key: string; outcomes: { name: string; price: number; point?: number; description?: string }[] }[],
): OddsApiBookmaker {
  const last_update = new Date().toISOString();
  return { key, title, last_update, markets: markets.map((m) => ({ ...m, last_update })) };
}

const ml = (a: string, pa: number, b: string, pb: number, draw?: number) => ({
  key: "h2h",
  outcomes:
    draw !== undefined
      ? [
          { name: a, price: pa },
          { name: b, price: pb },
          { name: "Draw", price: draw },
        ]
      : [
          { name: a, price: pa },
          { name: b, price: pb },
        ],
});

const total = (line: number, over: number, under: number) => ({
  key: "totals",
  outcomes: [
    { name: "Over", price: over, point: line },
    { name: "Under", price: under, point: line },
  ],
});

export const DEMO_EVENTS: OddsApiEvent[] = [
  // A clean soft-book overlay: DraftKings is a full tick behind Pinnacle on KC.
  {
    id: "demo-nfl-1",
    sport_key: "americanfootball_nfl",
    sport_title: "NFL",
    commence_time: hoursFromNow(20),
    home_team: "Kansas City Chiefs",
    away_team: "Buffalo Bills",
    bookmakers: [
      bk("pinnacle", "Pinnacle", [ml("Kansas City Chiefs", 1.93, "Buffalo Bills", 2.02), total(47.5, 1.92, 1.94)]),
      bk("draftkings", "DraftKings", [ml("Kansas City Chiefs", 2.08, "Buffalo Bills", 1.81), total(47.5, 1.87, 1.95)]),
      bk("fanduel", "FanDuel", [ml("Kansas City Chiefs", 1.95, "Buffalo Bills", 1.9), total(47.5, 1.9, 1.9)]),
      bk("betmgm", "BetMGM", [ml("Kansas City Chiefs", 1.91, "Buffalo Bills", 1.93)]),
    ],
  },

  // Everyone agrees. Nothing should surface from this fixture at all.
  {
    id: "demo-nfl-2",
    sport_key: "americanfootball_nfl",
    sport_title: "NFL",
    commence_time: hoursFromNow(24),
    home_team: "Baltimore Ravens",
    away_team: "Cincinnati Bengals",
    bookmakers: [
      bk("pinnacle", "Pinnacle", [ml("Baltimore Ravens", 1.68, "Cincinnati Bengals", 2.32)]),
      bk("draftkings", "DraftKings", [ml("Baltimore Ravens", 1.66, "Cincinnati Bengals", 2.28)]),
      bk("fanduel", "FanDuel", [ml("Baltimore Ravens", 1.67, "Cincinnati Bengals", 2.3)]),
    ],
  },

  // A modest overlay on the under, where the sharp reference is an exchange
  // rather than Pinnacle.
  {
    id: "demo-mlb-1",
    sport_key: "baseball_mlb",
    sport_title: "MLB",
    commence_time: hoursFromNow(6),
    home_team: "Los Angeles Dodgers",
    away_team: "San Diego Padres",
    bookmakers: [
      bk("matchbook", "Matchbook", [ml("Los Angeles Dodgers", 1.72, "San Diego Padres", 2.24), total(8.5, 1.95, 1.93)]),
      bk("lowvig", "LowVig", [ml("Los Angeles Dodgers", 1.74, "San Diego Padres", 2.2)]),
      bk("caesars", "Caesars", [ml("Los Angeles Dodgers", 1.7, "San Diego Padres", 2.36), total(8.5, 1.88, 2.08)]),
      bk("betrivers", "BetRivers", [ml("Los Angeles Dodgers", 1.71, "San Diego Padres", 2.29)]),
    ],
  },

  // Three-way soccer market. Pinnacle prices it; a soft book is long on the draw.
  {
    id: "demo-soccer-1",
    sport_key: "soccer_epl",
    sport_title: "EPL",
    commence_time: hoursFromNow(44),
    home_team: "Arsenal",
    away_team: "Chelsea",
    bookmakers: [
      bk("pinnacle", "Pinnacle", [ml("Arsenal", 1.98, "Chelsea", 3.95, 3.72)]),
      bk("williamhill", "William Hill", [ml("Arsenal", 1.9, "Chelsea", 3.8, 4.1)]),
      bk("betfair_ex_uk", "Betfair", [ml("Arsenal", 2.0, "Chelsea", 3.9, 3.8)]),
      bk("unibet", "Unibet", [ml("Arsenal", 1.92, "Chelsea", 4.2, 3.75)]),
    ],
  },

  // No sharp book at all: the consensus is soft-only and must be marked as weak.
  {
    id: "demo-tennis-1",
    sport_key: "tennis_atp_shanghai",
    sport_title: "ATP Shanghai",
    commence_time: hoursFromNow(11),
    home_team: "Carlos Alcaraz",
    away_team: "Jannik Sinner",
    bookmakers: [
      bk("draftkings", "DraftKings", [ml("Carlos Alcaraz", 2.15, "Jannik Sinner", 1.72)]),
      bk("fanduel", "FanDuel", [ml("Carlos Alcaraz", 1.98, "Jannik Sinner", 1.83)]),
      bk("betmgm", "BetMGM", [ml("Carlos Alcaraz", 1.95, "Jannik Sinner", 1.85)]),
    ],
  },

  // A stale line: far too good to be true, and the board should say so.
  {
    id: "demo-cfb-1",
    sport_key: "americanfootball_ncaaf",
    sport_title: "NCAAF",
    commence_time: hoursFromNow(3),
    home_team: "Michigan Wolverines",
    away_team: "Ohio State Buckeyes",
    bookmakers: [
      bk("pinnacle", "Pinnacle", [ml("Michigan Wolverines", 2.6, "Ohio State Buckeyes", 1.52)]),
      bk("betonlineag", "BetOnline", [ml("Michigan Wolverines", 2.55, "Ohio State Buckeyes", 1.55)]),
      bk("bovada", "Bovada", [ml("Michigan Wolverines", 3.4, "Ohio State Buckeyes", 1.36)]),
    ],
  },

  // Player props on a single event, priced by a sharp book and one soft book.
  {
    id: "demo-nfl-3",
    sport_key: "americanfootball_nfl",
    sport_title: "NFL",
    commence_time: hoursFromNow(28),
    home_team: "San Francisco 49ers",
    away_team: "Seattle Seahawks",
    bookmakers: [
      bk("pinnacle", "Pinnacle", [
        {
          key: "player_pass_yds",
          outcomes: [
            { name: "Over", price: 1.91, point: 264.5, description: "Brock Purdy" },
            { name: "Under", price: 1.93, point: 264.5, description: "Brock Purdy" },
          ],
        },
      ]),
      bk("draftkings", "DraftKings", [
        {
          key: "player_pass_yds",
          outcomes: [
            { name: "Over", price: 2.05, point: 264.5, description: "Brock Purdy" },
            { name: "Under", price: 1.78, point: 264.5, description: "Brock Purdy" },
          ],
        },
      ]),
    ],
  },
];
