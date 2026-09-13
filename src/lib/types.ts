export type Sport = {
  key: string;
  group: string;
  title: string;
  description: string;
  active: boolean;
  has_outrights: boolean;
};

export type Outcome = {
  name: string;
  price: number;
  point?: number;
  description?: string;
};

export type Market = {
  key: string;
  last_update?: string;
  outcomes: Outcome[];
};

export type Bookmaker = {
  key: string;
  title: string;
  last_update?: string;
  markets: Market[];
};

export type Event = {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: Bookmaker[];
};

export type ScoreEvent = {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  completed: boolean;
  home_team: string;
  away_team: string;
  scores: { name: string; score: string }[] | null;
  last_update: string | null;
};

export type QuotaInfo = {
  remaining: number | null;
  used: number | null;
  lastCost: number | null;
};

export type ApiEnvelope<T> = {
  data: T;
  quota: QuotaInfo;
  fetchedAt: string;
};

/** Лучшая цена по исходу среди всех букмекеров */
export type BestPrice = {
  outcome: string;
  point?: number;
  price: number;
  bookmaker: string;
  bookmakerKey: string;
  allPrices: { bookmaker: string; bookmakerKey: string; price: number }[];
};

export type ArbOpportunity = {
  eventId: string;
  sportKey: string;
  sportTitle: string;
  commenceTime: string;
  match: string;
  market: string;
  marketLabel: string;
  totalImplied: number;
  profitPct: number;
  legs: {
    outcome: string;
    point?: number;
    price: number;
    bookmaker: string;
    stakeShare: number;
  }[];
};

export type ValueBet = {
  eventId: string;
  sportKey: string;
  sportTitle: string;
  commenceTime: string;
  match: string;
  market: string;
  marketLabel: string;
  outcome: string;
  point?: number;
  bookmaker: string;
  price: number;
  fairPrice: number;
  fairProb: number;
  edgePct: number;
  evPer100: number;
  kelly: number;
  booksCount: number;
};

export type TrackedBet = {
  id: string;
  createdAt: string;
  eventDate?: string;
  sport: string;
  match: string;
  market: string;
  selection: string;
  bookmaker: string;
  odds: number;
  stake: number;
  status: "pending" | "won" | "lost" | "void" | "cashout";
  cashoutReturn?: number;
  note?: string;
  tags?: string[];
};
