import type { ApiEnvelope, Event, ScoreEvent, Sport, QuotaInfo } from "./types";

const BASE = "https://api.the-odds-api.com/v4";

export class OddsApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "OddsApiError";
  }
}

export function getApiKey(): string {
  const key = process.env.ODDS_API_KEY?.trim();
  if (!key) {
    throw new OddsApiError(
      "Не задан ODDS_API_KEY. Добавьте ключ The Odds API в .env.local — приложение работает только на реальных данных.",
      503
    );
  }
  return key;
}

export function hasApiKey(): boolean {
  return Boolean(process.env.ODDS_API_KEY?.trim());
}

export function defaultRegions(): string {
  return process.env.ODDS_API_REGIONS?.trim() || "eu,uk,us";
}

type FetchOpts = { revalidate?: number };

async function call<T>(
  path: string,
  params: Record<string, string | number | undefined>,
  opts: FetchOpts = {}
): Promise<ApiEnvelope<T>> {
  const url = new URL(BASE + path);
  url.searchParams.set("apiKey", getApiKey());
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString(), {
    next: { revalidate: opts.revalidate ?? 60 },
  });

  const quota: QuotaInfo = {
    remaining: num(res.headers.get("x-requests-remaining")),
    used: num(res.headers.get("x-requests-used")),
    lastCost: num(res.headers.get("x-requests-last")),
  };

  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try {
      const j = JSON.parse(text);
      msg = j.message || j.error_code || text;
    } catch {
      /* raw text */
    }
    throw new OddsApiError(
      `The Odds API ${res.status}: ${msg?.slice(0, 300) || "ошибка запроса"}`,
      res.status
    );
  }

  const data = (await res.json()) as T;
  return { data, quota, fetchedAt: new Date().toISOString() };
}

function num(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function getSports(all = false) {
  return call<Sport[]>("/sports", { all: all ? "true" : undefined }, { revalidate: 3600 });
}

export function getOdds(opts: {
  sport: string;
  regions?: string;
  markets?: string;
  oddsFormat?: "decimal" | "american";
  dateFormat?: "iso" | "unix";
  bookmakers?: string;
  eventIds?: string;
  revalidate?: number;
}) {
  const { sport, revalidate, ...rest } = opts;
  return call<Event[]>(
    `/sports/${encodeURIComponent(sport)}/odds`,
    {
      regions: rest.bookmakers ? undefined : rest.regions || defaultRegions(),
      markets: rest.markets || "h2h",
      oddsFormat: rest.oddsFormat || "decimal",
      dateFormat: rest.dateFormat || "iso",
      bookmakers: rest.bookmakers,
      eventIds: rest.eventIds,
    },
    { revalidate: revalidate ?? 60 }
  );
}

export function getEventOdds(opts: {
  sport: string;
  eventId: string;
  regions?: string;
  markets?: string;
}) {
  return call<Event>(
    `/sports/${encodeURIComponent(opts.sport)}/events/${encodeURIComponent(opts.eventId)}/odds`,
    {
      regions: opts.regions || defaultRegions(),
      markets: opts.markets || "h2h,spreads,totals",
      oddsFormat: "decimal",
      dateFormat: "iso",
    },
    { revalidate: 45 }
  );
}

export function getEvents(sport: string) {
  return call<Event[]>(
    `/sports/${encodeURIComponent(sport)}/events`,
    { dateFormat: "iso" },
    { revalidate: 120 }
  );
}

export function getScores(sport: string, daysFrom = 2) {
  return call<ScoreEvent[]>(
    `/sports/${encodeURIComponent(sport)}/scores`,
    { daysFrom, dateFormat: "iso" },
    { revalidate: 30 }
  );
}
