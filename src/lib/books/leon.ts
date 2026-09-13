import type { BookAdapter, BookEvent, SportKey, TotalLine, HandicapLine } from "./types";
import { getJsonFirst, roundLine } from "./http";
import { RU_SPORT_MATCH } from "./platform";

/**
 * Леон. Официальное публичное API, которым пользуется сайт leon.ru:
 *
 *   прематч: https://leon.ru/api-2/betline/events/prematch?ctag=ru-RU
 *   лайв:    https://leon.ru/api-2/betline/events/inplay?ctag=ru-RU
 *
 * Ответ: { events: [ { id, sport: { name }, league: { name }, kickoff (сек),
 *   competitors: [ { name, homeAway: "home"|"away" } ],
 *   markets: [ { name, runners: [ { name: "1"|"X"|"2"|"Больше 2.5"…, price } ] } ] } ] }
 */

const HOSTS = ["https://leon.ru", "https://www.leon.ru"];
const preUrls = HOSTS.map((h) => `${h}/api-2/betline/events/prematch?ctag=ru-RU`);
const liveUrls = HOSTS.map((h) => `${h}/api-2/betline/events/inplay?ctag=ru-RU`);

type LeonRunner = { name?: string; price?: number; line?: number; param?: number };
type LeonMarket = { name?: string; runners?: LeonRunner[] };
type LeonEvent = {
  id?: number | string;
  sport?: { name?: string } | string;
  league?: { name?: string } | string;
  kickoff?: number;
  competitors?: { name?: string; homeAway?: string }[];
  markets?: LeonMarket[];
};
type LeonResponse = { events?: LeonEvent[] };

const num = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) && n > 1.01 && n < 1000 ? n : undefined;
};

export function parseEvent(e: LeonEvent, sport: SportKey, live: boolean): BookEvent | null {
  const sportName = typeof e.sport === "string" ? e.sport : e.sport?.name || "";
  if (sportName && !RU_SPORT_MATCH[sport].test(sportName)) return null;

  const comps = e.competitors || [];
  if (comps.length < 2) return null;
  const homeComp = comps.find((c) => c.homeAway === "home") ?? comps[0];
  const awayComp = comps.find((c) => c.homeAway === "away") ?? comps[1];
  const home = String(homeComp?.name ?? "").trim();
  const away = String(awayComp?.name ?? "").trim();
  if (!home || !away) return null;

  const ml: { home?: number; draw?: number; away?: number } = {};
  const totalsMap = new Map<number, TotalLine>();
  const hcapMap = new Map<number, HandicapLine>();

  for (const market of e.markets || []) {
    const mname = String(market.name ?? "").toLowerCase();
    for (const r of market.runners || []) {
      const price = num(r.price);
      if (!price) continue;
      const rname = String(r.name ?? "").toLowerCase().trim();
      const line = r.line ?? r.param;

      // исход матча
      if (rname === "1" || rname === "п1" || rname === "w1") ml.home = price;
      else if (rname === "x" || rname === "х" || rname === "ничья") ml.draw = price;
      else if (rname === "2" || rname === "п2" || rname === "w2") ml.away = price;
      // тоталы: «Больше 2.5» / «Меньше 2.5» или линия в параметре
      else if (/^(больше|over|тб)/.test(rname)) {
        const m = rname.match(/(\d+[.,]?\d*)/);
        const ln = roundLine(m ? Number(m[1].replace(",", ".")) : Number(line));
        if (Number.isFinite(ln) && ln > 0) {
          const t = totalsMap.get(ln) || { line: ln };
          t.over = price;
          totalsMap.set(ln, t);
        }
      } else if (/^(меньше|under|тм)/.test(rname)) {
        const m = rname.match(/(\d+[.,]?\d*)/);
        const ln = roundLine(m ? Number(m[1].replace(",", ".")) : Number(line));
        if (Number.isFinite(ln) && ln > 0) {
          const t = totalsMap.get(ln) || { line: ln };
          t.under = price;
          totalsMap.set(ln, t);
        }
      }
      // форы: «Ф1(-1.5)» / «Ф2(+1.5)»
      else if (/^(ф1|фора 1|handicap 1)/.test(rname)) {
        const m = rname.match(/-?\d+[.,]?\d*/);
        const ln = roundLine(m ? Number(m[0].replace(",", ".")) : Number(line));
        if (Number.isFinite(ln)) {
          const h = hcapMap.get(ln) || { line: ln };
          h.home = price;
          hcapMap.set(ln, h);
        }
      } else if (/^(ф2|фора 2|handicap 2)/.test(rname)) {
        const m = rname.match(/[+-]?\d+[.,]?\d*/);
        const raw = m ? Number(m[0].replace(",", ".")) : Number(line);
        if (Number.isFinite(raw)) {
          const signed = -raw;
          const h = hcapMap.get(signed) || { line: signed };
          h.away = price;
          hcapMap.set(signed, h);
        }
      }
      void mname;
    }
  }

  if (!ml.home && !ml.away) return null;

  const league = typeof e.league === "string" ? e.league : e.league?.name || "";
  return {
    bookKey: "leon",
    bookTitle: "Леон",
    bookEventId: String(e.id ?? `${home}-${away}`),
    sport,
    league,
    home,
    away,
    startTime: e.kickoff ? new Date(e.kickoff > 1e12 ? e.kickoff : e.kickoff * 1000).toISOString() : new Date().toISOString(),
    live,
    url: "https://leon.ru/",
    markets: {
      moneyline: ml,
      totals: [...totalsMap.values()].filter((t) => t.over && t.under).sort((a, b) => a.line - b.line),
      handicaps: [...hcapMap.values()].filter((h) => h.home && h.away).sort((a, b) => a.line - b.line),
    },
  };
}

const isValid = (d: LeonResponse) => Array.isArray(d?.events) && d.events.length > 0;

async function fetchLine(sport: SportKey, signal: AbortSignal) {
  const pre = await getJsonFirst<LeonResponse>(preUrls, signal, {
    cacheKey: "leon:pre",
    isValid,
  });
  const preEvents = pre.data?.events ?? [];
  let events = preEvents.map((e) => parseEvent(e, sport, false)).filter(Boolean) as BookEvent[];
  const endpoint = pre.url;
  const rawCount = preEvents.length;

  try {
    const live = await getJsonFirst<LeonResponse>(liveUrls, signal, {
      cacheKey: "leon:live",
      isValid,
    });
    const liveEvents = (live.data?.events ?? [])
      .map((e) => parseEvent(e, sport, true))
      .filter(Boolean) as BookEvent[];
    const seen = new Set(events.map((e) => e.bookEventId));
    events = [...liveEvents, ...events.filter((e) => !seen.has(e.bookEventId))];
  } catch {
    /* лайв недоступен — остаётся прематч */
  }

  return { events, endpoint, rawCount, dnsVia: pre.dnsVia, insecure: pre.insecure, tried: pre.tried };
}

export const leon: BookAdapter = {
  key: "leon",
  title: "Леон",
  site: "https://leon.ru",
  sports: ["football", "hockey", "tennis", "basketball", "volleyball", "table_tennis", "mma", "esports"],
  fetchLine,
};
