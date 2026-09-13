import type { BookAdapter, BookEvent, SportKey, TotalLine, HandicapLine } from "./types";
import { getJsonFirst, roundLine } from "./http";

/**
 * Олимп (olimp.bet / olimpbet.kz). Публичное API линии.
 */

const SPORT_NAMES: Record<SportKey, RegExp> = {
  football: /футбол/i,
  hockey: /хоккей/i,
  tennis: /^теннис/i,
  basketball: /баскетбол/i,
  volleyball: /волейбол/i,
  table_tennis: /настольный теннис/i,
  mma: /mma|бокс|смешанные/i,
  esports: /кибер|dota|counter|lol/i,
};

const ENDPOINTS = [
  "https://olimp.bet/api/v3/line/sports",
  "https://www.olimp.bet/api/v3/line/sports",
  "https://olimp.bet/api/v1/line/sports",
  "https://olimp.bet/api/v1/line",
];

type AnyRec = Record<string, any>;

function collectEvents(node: any, acc: AnyRec[] = [], depth = 0): AnyRec[] {
  if (!node || depth > 6) return acc;
  if (Array.isArray(node)) {
    for (const n of node) collectEvents(n, acc, depth + 1);
    return acc;
  }
  if (typeof node === "object") {
    const hasTeams =
      (node.team1 || node.opp1 || node.home) && (node.team2 || node.opp2 || node.away);
    if (hasTeams) acc.push(node);
    for (const k of ["events", "matches", "items", "children", "tournaments", "leagues", "data", "sports"]) {
      if (node[k]) collectEvents(node[k], acc, depth + 1);
    }
  }
  return acc;
}

function parseMarkets(e: AnyRec) {
  const ml: { home?: number; draw?: number; away?: number } = {};
  const dc: { homeDraw?: number; homeAway?: number; drawAway?: number } = {};
  const totalsMap = new Map<number, TotalLine>();
  const hcapMap = new Map<number, HandicapLine>();
  const btts: { yes?: number; no?: number } = {};

  const num = (v: any) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 1 ? n : undefined;
  };

  ml.home = num(e.win1 ?? e.w1 ?? e.p1 ?? e.coef1);
  ml.draw = num(e.draw ?? e.x ?? e.coefX);
  ml.away = num(e.win2 ?? e.w2 ?? e.p2 ?? e.coef2);
  dc.homeDraw = num(e.win1draw ?? e["1x"]);
  dc.homeAway = num(e.win1win2 ?? e["12"]);
  dc.drawAway = num(e.drawwin2 ?? e["x2"]);

  const outcomes: AnyRec[] = [];
  for (const k of ["factors", "outcomes", "markets", "coefs", "odds"]) {
    if (Array.isArray(e[k])) outcomes.push(...e[k]);
  }
  for (const o of outcomes) {
    const name = String(o.name ?? o.caption ?? o.type ?? "").toLowerCase().replace(/\s+/g, "");
    const price = num(o.value ?? o.coef ?? o.factor ?? o.odd);
    const param = Number(o.param ?? o.parameter ?? o.total ?? o.hcap);
    if (!price) continue;
    if (name === "1" || name === "п1") ml.home = price;
    else if (name === "x" || name === "х") ml.draw = price;
    else if (name === "2" || name === "п2") ml.away = price;
    else if (/^(тб|over|больше)/.test(name) && Number.isFinite(param)) {
      const line = roundLine(param);
      const t = totalsMap.get(line) || { line };
      t.over = price;
      totalsMap.set(line, t);
    } else if (/^(тм|under|меньше)/.test(name) && Number.isFinite(param)) {
      const line = roundLine(param);
      const t = totalsMap.get(line) || { line };
      t.under = price;
      totalsMap.set(line, t);
    } else if (/^(ф1|фора1)/.test(name) && Number.isFinite(param)) {
      const line = roundLine(param);
      const h = hcapMap.get(line) || { line };
      h.home = price;
      hcapMap.set(line, h);
    } else if (/^(ф2|фора2)/.test(name) && Number.isFinite(param)) {
      const line = roundLine(-param);
      const h = hcapMap.get(line) || { line };
      h.away = price;
      hcapMap.set(line, h);
    }
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
  const loaded = await getJsonFirst<any>(ENDPOINTS, signal, {
    cacheKey: "olimp",
    isValid: (d) => Boolean(d),
  });
  const raw = loaded.data;
  const endpoint = loaded.url;
  if (!raw) throw new Error("Линия Олимпа ответила пусто");

  const all = collectEvents(raw);
  const re = SPORT_NAMES[sport];
  const out: BookEvent[] = [];
  for (const e of all) {
    const sportName = String(e.sportName ?? e.sport ?? e.sport_name ?? "");
    if (sportName && !re.test(sportName)) continue;
    const home = String(e.team1 ?? e.opp1 ?? e.home ?? "");
    const away = String(e.team2 ?? e.opp2 ?? e.away ?? "");
    if (!home || !away) continue;
    const markets = parseMarkets(e);
    if (!markets.moneyline.home && !markets.moneyline.away) continue;
    const t = e.date ?? e.startTime ?? e.start ?? e.time;
    const startTime =
      typeof t === "number"
        ? new Date(t > 1e12 ? t : t * 1000).toISOString()
        : t
        ? new Date(String(t)).toISOString()
        : new Date().toISOString();
    out.push({
      bookKey: "olimp",
      bookTitle: "Олимп",
      bookEventId: String(e.id ?? e.eventId ?? `${home}-${away}`),
      sport,
      league: String(e.tournament ?? e.league ?? e.champName ?? ""),
      home,
      away,
      startTime: isNaN(+new Date(startTime)) ? new Date().toISOString() : startTime,
      live: Boolean(e.isLive ?? e.live),
      url: "https://olimp.bet/",
      markets,
    });
  }
  return { events: out, endpoint, rawCount: all.length, dnsVia: loaded.dnsVia, insecure: loaded.insecure, tried: loaded.tried };
}

export const olimp: BookAdapter = {
  key: "olimp",
  title: "Олимп",
  site: "https://olimp.bet",
  sports: ["football", "hockey", "tennis", "basketball", "volleyball", "table_tennis", "mma", "esports"],
  fetchLine,
};
