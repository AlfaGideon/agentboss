import type { BookAdapter, BookEvent, SportKey, TotalLine, HandicapLine } from "./types";
import { getJsonFirst, roundLine } from "./http";
import { RU_SPORT_MATCH } from "./platform";

/**
 * Олимп. Официальное публичное API линии, которым пользуется сайт olimp.bet:
 *
 *   прематч: https://www.olimp.bet/api/v4/0/line/sports-with-competitions-with-events?vids[]=
 *   лайв:    https://www.olimp.bet/api/v4/0/live/sports-with-competitions-with-events?vids[]=
 *
 * Ответ — массив секций по видам спорта:
 *   [{ payload: { sport: { id, name }, competitionsWithEvents: [
 *        { name, events: [ { id, team1Name, team2Name, startDateTime,
 *            sportName, competitionName,
 *            outcomes: [ { shortName: "П1"|"Х"|"П2"|"ТБ"|"ТМ"|"Ф1"|"Ф2",
 *                          probability: "2.10" (это коэффициент), param: линия } ] } ] } ] } }]
 */

const HOSTS = ["https://www.olimp.bet", "https://olimp.bet"];

const preUrls = HOSTS.map(
  (h) => `${h}/api/v4/0/line/sports-with-competitions-with-events?vids%5B%5D=`
).concat(
  HOSTS.map((h) => `${h}/api/v4/0/line/all/sports-with-competitions-with-events?vids%5B%5D=`),
  HOSTS.map((h) => `${h}/api/v4/0/line/top/sports-with-competitions-with-events?vids%5B%5D=`)
);
const liveUrls = HOSTS.map(
  (h) => `${h}/api/v4/0/live/sports-with-competitions-with-events?vids%5B%5D=`
);

type OlOutcome = {
  shortName?: string;
  name?: string;
  probability?: string | number;
  param?: number | string;
  tableType?: string;
};
type OlEvent = {
  id?: number | string;
  team1Name?: string;
  team2Name?: string;
  startDateTime?: string | number;
  sportName?: string;
  competitionName?: string;
  outcomes?: OlOutcome[];
};
type OlSection = {
  payload?: {
    sport?: { id?: string | number; name?: string; names?: Record<string, string> };
    competitionsWithEvents?: {
      name?: string;
      competitionName?: string;
      competition?: { name?: string; names?: Record<string, string> };
      events?: OlEvent[];
    }[];
  };
};

const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
  return Number.isFinite(n) && n > 1.01 && n < 1000 ? n : undefined;
};

const lineVal = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
  return Number.isFinite(n) && n !== 0 ? roundLine(n) : undefined;
};

function startTime(e: OlEvent): string {
  const raw = e.startDateTime;
  if (typeof raw === "number") return new Date(raw > 1e12 ? raw : raw * 1000).toISOString();
  if (typeof raw === "string") {
    const d = new Date(raw);
    if (!isNaN(+d)) return d.toISOString();
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return new Date(n > 1e12 ? n : n * 1000).toISOString();
  }
  return new Date().toISOString();
}

export function parseEvent(e: OlEvent, sport: SportKey, league: string, live: boolean): BookEvent | null {
  const home = e.team1Name?.trim();
  const away = e.team2Name?.trim();
  if (!home || !away) return null;

  if (e.sportName && !RU_SPORT_MATCH[sport].test(e.sportName)) return null;

  const ml: { home?: number; draw?: number; away?: number } = {};
  const totalsMap = new Map<number, TotalLine>();
  const hcapMap = new Map<number, HandicapLine>();

  for (const o of e.outcomes || []) {
    const name = String(o.shortName ?? o.name ?? "").trim().toLowerCase();
    const price = num(o.probability);
    if (!name || !price) continue;
    const line = lineVal(o.param);

    if (name === "п1" || name === "1" || name === "w1") ml.home = price;
    else if (name === "х" || name === "x" || name === "ничья") ml.draw = price;
    else if (name === "п2" || name === "2" || name === "w2") ml.away = price;
    else if (/^(тб|бол|больше|over)/.test(name) && line != null) {
      const t = totalsMap.get(line) || { line };
      t.over = price;
      totalsMap.set(line, t);
    } else if (/^(тм|мен|меньше|under)/.test(name) && line != null) {
      const t = totalsMap.get(line) || { line };
      t.under = price;
      totalsMap.set(line, t);
    } else if (/^(ф1|фора1)/.test(name) && line != null) {
      const h = hcapMap.get(line) || { line };
      h.home = price;
      hcapMap.set(line, h);
    } else if (/^(ф2|фора2)/.test(name) && line != null) {
      const signed = -line;
      const h = hcapMap.get(signed) || { line: signed };
      h.away = price;
      hcapMap.set(signed, h);
    }
  }

  if (!ml.home && !ml.away) return null;

  return {
    bookKey: "olimp",
    bookTitle: "Олимп",
    bookEventId: String(e.id ?? `${home}-${away}`),
    sport,
    league: league || e.competitionName || "",
    home,
    away,
    startTime: startTime(e),
    live,
    url: "https://www.olimp.bet/",
    markets: {
      moneyline: ml,
      totals: [...totalsMap.values()].filter((t) => t.over && t.under).sort((a, b) => a.line - b.line),
      handicaps: [...hcapMap.values()].filter((h) => h.home && h.away).sort((a, b) => a.line - b.line),
    },
  };
}

export function parseSections(sections: OlSection[], sport: SportKey, live: boolean): BookEvent[] {
  const out: BookEvent[] = [];
  for (const section of sections || []) {
    const payload = section?.payload;
    if (!payload) continue;
    const sportName = payload.sport?.name || payload.sport?.names?.["0"] || "";
    if (sportName && !RU_SPORT_MATCH[sport].test(sportName)) continue;

    for (const comp of payload.competitionsWithEvents || []) {
      const league =
        comp.name ||
        comp.competitionName ||
        comp.competition?.name ||
        comp.competition?.names?.["0"] ||
        "";
      for (const e of comp.events || []) {
        const parsed = parseEvent(e, sport, league, live);
        if (parsed) out.push(parsed);
      }
    }
  }
  return out;
}

const isValid = (d: OlSection[]) => Array.isArray(d) && d.some((s) => s?.payload?.competitionsWithEvents?.length);

async function fetchLine(sport: SportKey, signal: AbortSignal) {
  const pre = await getJsonFirst<OlSection[]>(preUrls, signal, {
    cacheKey: "olimp:pre",
    isValid,
  });
  let events = parseSections(pre.data, sport, false);
  const endpoint = pre.url;
  const rawCount = pre.data.length;

  try {
    const live = await getJsonFirst<OlSection[]>(liveUrls, signal, {
      cacheKey: "olimp:live",
      isValid,
    });
    const liveEvents = parseSections(live.data, sport, true);
    const seen = new Set(liveEvents.map((e) => e.bookEventId));
    events = [...liveEvents, ...events.filter((e) => !seen.has(e.bookEventId))];
  } catch {
    /* лайв недоступен — отдаём прематч */
  }

  return { events, endpoint, rawCount, dnsVia: pre.dnsVia, insecure: pre.insecure, tried: pre.tried };
}

export const olimp: BookAdapter = {
  key: "olimp",
  title: "Олимп",
  site: "https://www.olimp.bet",
  sports: ["football", "hockey", "tennis", "basketball", "volleyball", "table_tennis", "mma", "esports"],
  fetchLine,
};
