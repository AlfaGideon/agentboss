import type { BookAdapter, BookEvent, SportKey, TotalLine, HandicapLine } from "./types";
import { getJsonFirst, roundLine } from "./http";

/**
 * Лига Ставок. Публичное API витрины (api.ligastavok.ru / ligastavok.ru/api).
 */

const SPORT_IDS: Partial<Record<SportKey, number>> = {
  football: 1,
  hockey: 2,
  tennis: 3,
  basketball: 4,
  volleyball: 5,
  table_tennis: 21,
  mma: 13,
  esports: 40,
};

type LsOutcome = { id?: number; typeId?: number; type?: string; value?: number; param?: number; name?: string };
type LsMarket = { id?: number; typeId?: number; name?: string; outcomes?: LsOutcome[] };
type LsEvent = {
  id?: number | string;
  eventId?: number | string;
  sportId?: number;
  tournamentName?: string;
  championshipName?: string;
  league?: string;
  name?: string;
  team1?: string;
  team2?: string;
  homeTeam?: string | { name?: string };
  awayTeam?: string | { name?: string };
  startDate?: string;
  startTime?: string | number;
  date?: string;
  isLive?: boolean;
  live?: boolean;
  markets?: LsMarket[];
  factors?: Record<string, number>;
};

const endpoints = (sportId: number) => [
  `https://api.ligastavok.ru/api/v1/line/events?sportIds=${sportId}&limit=200`,
  `https://ligastavok.ru/api/v1/line/events?sportIds=${sportId}&limit=200`,
  `https://www.ligastavok.ru/api/v1/line/events?sportIds=${sportId}&limit=200`,
  `https://api.ligastavok.ru/v1/line/sport/${sportId}/events`,
];

const str = (v: unknown): string =>
  typeof v === "string" ? v : v && typeof v === "object" && "name" in (v as any) ? String((v as any).name ?? "") : "";

function parseTime(e: LsEvent): string {
  const raw = e.startDate ?? e.startTime ?? e.date;
  if (raw == null) return new Date().toISOString();
  if (typeof raw === "number") return new Date(raw > 1e12 ? raw : raw * 1000).toISOString();
  const d = new Date(raw);
  return isNaN(+d) ? new Date().toISOString() : d.toISOString();
}

/** Разбор рынков: поддерживаем и market/outcomes, и плоский factors */
function parseMarkets(e: LsEvent) {
  const ml: { home?: number; draw?: number; away?: number } = {};
  const totalsMap = new Map<number, TotalLine>();
  const hcapMap = new Map<number, HandicapLine>();
  const dc: { homeDraw?: number; homeAway?: number; drawAway?: number } = {};
  const btts: { yes?: number; no?: number } = {};

  const push = (name: string, value: number, param?: number) => {
    const n = name.toLowerCase().replace(/\s+/g, "");
    if (!value || value <= 1) return;
    if (n === "1" || n === "п1" || n === "w1" || n === "home") ml.home = value;
    else if (n === "x" || n === "х" || n === "draw" || n === "ничья") ml.draw = value;
    else if (n === "2" || n === "п2" || n === "w2" || n === "away") ml.away = value;
    else if (n === "1x" || n === "1х") dc.homeDraw = value;
    else if (n === "12") dc.homeAway = value;
    else if (n === "x2" || n === "х2") dc.drawAway = value;
    else if (/^(тб|over|больше)/.test(n) && param != null) {
      const line = roundLine(param);
      const t = totalsMap.get(line) || { line };
      t.over = value;
      totalsMap.set(line, t);
    } else if (/^(тм|under|меньше)/.test(n) && param != null) {
      const line = roundLine(param);
      const t = totalsMap.get(line) || { line };
      t.under = value;
      totalsMap.set(line, t);
    } else if (/^(ф1|h1|фора1)/.test(n) && param != null) {
      const line = roundLine(param);
      const h = hcapMap.get(line) || { line };
      h.home = value;
      hcapMap.set(line, h);
    } else if (/^(ф2|h2|фора2)/.test(n) && param != null) {
      const line = roundLine(-param);
      const h = hcapMap.get(line) || { line };
      h.away = value;
      hcapMap.set(line, h);
    } else if (/обезабьют.*да|btts.*yes/.test(n)) btts.yes = value;
    else if (/обезабьют.*нет|btts.*no/.test(n)) btts.no = value;
  };

  for (const m of e.markets || []) {
    for (const o of m.outcomes || []) {
      const nm = o.name || o.type || "";
      if (o.value) push(nm, o.value, o.param);
    }
  }
  if (e.factors) {
    for (const [k, v] of Object.entries(e.factors)) push(k, v);
  }

  return {
    moneyline: ml,
    doubleChance: dc,
    btts,
    totals: [...totalsMap.values()].filter((t) => t.over && t.under).sort((a, b) => a.line - b.line),
    handicaps: [...hcapMap.values()].filter((h) => h.home && h.away).sort((a, b) => a.line - b.line),
  };
}

async function fetchLine(sport: SportKey, signal: AbortSignal) {
  const sportId = SPORT_IDS[sport];
  if (!sportId) return { events: [], endpoint: "", rawCount: 0 };

  const loaded = await getJsonFirst<any>(endpoints(sportId), signal, {
    cacheKey: "ligastavok",
    isValid: (d) => Boolean(d),
  });
  const raw = loaded.data;
  const endpoint = loaded.url;
  if (!raw) throw new Error("Линия Лиги Ставок ответила пусто");

  const list: LsEvent[] = Array.isArray(raw)
    ? raw
    : raw.events || raw.data?.events || raw.items || raw.data || [];

  const out: BookEvent[] = [];
  for (const e of list) {
    const home = e.team1 || str(e.homeTeam);
    const away = e.team2 || str(e.awayTeam);
    let h = home;
    let a = away;
    if ((!h || !a) && e.name?.includes(" - ")) {
      const [x, y] = e.name.split(" - ");
      h = h || x?.trim();
      a = a || y?.trim();
    }
    if (!h || !a) continue;
    const markets = parseMarkets(e);
    if (!markets.moneyline.home && !markets.moneyline.away) continue;
    const id = String(e.id ?? e.eventId ?? `${h}-${a}`);
    out.push({
      bookKey: "ligastavok",
      bookTitle: "Лига Ставок",
      bookEventId: id,
      sport,
      league: e.tournamentName || e.championshipName || e.league || "",
      home: h,
      away: a,
      startTime: parseTime(e),
      live: Boolean(e.isLive ?? e.live),
      url: `https://www.ligastavok.ru/bets/event/${id}`,
      markets,
    });
  }
  return { events: out, endpoint, rawCount: list.length, dnsVia: loaded.dnsVia, insecure: loaded.insecure, tried: loaded.tried };
}

export const ligastavok: BookAdapter = {
  key: "ligastavok",
  title: "Лига Ставок",
  site: "https://www.ligastavok.ru",
  sports: ["football", "hockey", "tennis", "basketball", "volleyball", "table_tennis", "mma", "esports"],
  fetchLine,
};
