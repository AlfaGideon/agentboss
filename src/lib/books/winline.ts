import type { BookAdapter, BookEvent, SportKey, TotalLine, HandicapLine } from "./types";
import { getJson, roundLine } from "./http";

/**
 * Winline. Публичное API витрины (wl-nsk.winline.ru / winline.ru/api).
 */

const SPORT_IDS: Partial<Record<SportKey, number>> = {
  football: 1,
  hockey: 2,
  basketball: 3,
  tennis: 4,
  volleyball: 6,
  table_tennis: 25,
  mma: 12,
  esports: 30,
};

const endpoints = (id: number) => [
  `https://wl-nsk.winline.ru/betting/api/v1/line/sport/${id}/events`,
  `https://winline.ru/betting/api/v1/line/sport/${id}/events`,
  `https://wl-nsk.winline.ru/betting/api/v1/line/events?sportId=${id}`,
];

type WlOutcome = { name?: string; caption?: string; value?: number; coefficient?: number; param?: number; parameter?: number };
type WlMarket = { name?: string; caption?: string; outcomes?: WlOutcome[]; factors?: WlOutcome[] };
type WlEvent = {
  id?: number | string;
  eventId?: number | string;
  sportId?: number;
  championship?: string | { name?: string };
  tournament?: string | { name?: string };
  team1?: string;
  team2?: string;
  opponent1?: string | { name?: string };
  opponent2?: string | { name?: string };
  name?: string;
  date?: string | number;
  startDate?: string | number;
  isLive?: boolean;
  markets?: WlMarket[];
};

const str = (v: unknown): string =>
  typeof v === "string" ? v : v && typeof v === "object" && "name" in (v as any) ? String((v as any).name ?? "") : "";

function parseTime(v: unknown): string {
  if (typeof v === "number") return new Date(v > 1e12 ? v : v * 1000).toISOString();
  if (typeof v === "string") {
    const d = new Date(v);
    if (!isNaN(+d)) return d.toISOString();
  }
  return new Date().toISOString();
}

function parseMarkets(e: WlEvent) {
  const ml: { home?: number; draw?: number; away?: number } = {};
  const dc: { homeDraw?: number; homeAway?: number; drawAway?: number } = {};
  const btts: { yes?: number; no?: number } = {};
  const totalsMap = new Map<number, TotalLine>();
  const hcapMap = new Map<number, HandicapLine>();

  for (const m of e.markets || []) {
    const mname = (m.name || m.caption || "").toLowerCase();
    for (const o of m.outcomes || m.factors || []) {
      const price = o.value ?? o.coefficient;
      if (!price || price <= 1) continue;
      const oname = (o.name || o.caption || "").toLowerCase().replace(/\s+/g, "");
      const param = o.param ?? o.parameter;

      if (/исход|1x2|победител/.test(mname) || ["1", "x", "х", "2"].includes(oname)) {
        if (oname === "1" || oname === "п1") ml.home = price;
        else if (oname === "x" || oname === "х") ml.draw = price;
        else if (oname === "2" || oname === "п2") ml.away = price;
      }
      if (/двойной/.test(mname)) {
        if (oname === "1x" || oname === "1х") dc.homeDraw = price;
        else if (oname === "12") dc.homeAway = price;
        else if (oname === "x2" || oname === "х2") dc.drawAway = price;
      }
      if (/тотал/.test(mname) && param != null) {
        const line = roundLine(param);
        const t = totalsMap.get(line) || { line };
        if (/^(тб|б|over|больше)/.test(oname)) t.over = price;
        else if (/^(тм|м|under|меньше)/.test(oname)) t.under = price;
        totalsMap.set(line, t);
      }
      if (/фора|гандикап/.test(mname) && param != null) {
        if (/^(ф1|1)/.test(oname)) {
          const line = roundLine(param);
          const h = hcapMap.get(line) || { line };
          h.home = price;
          hcapMap.set(line, h);
        } else if (/^(ф2|2)/.test(oname)) {
          const line = roundLine(-param);
          const h = hcapMap.get(line) || { line };
          h.away = price;
          hcapMap.set(line, h);
        }
      }
      if (/обе забьют/.test(mname)) {
        if (/да|yes/.test(oname)) btts.yes = price;
        else if (/нет|no/.test(oname)) btts.no = price;
      }
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
  const id = SPORT_IDS[sport];
  if (!id) return { events: [], endpoint: "", rawCount: 0 };

  let raw: any = null;
  let endpoint = "";
  let lastErr: unknown = null;
  for (const url of endpoints(id)) {
    try {
      raw = await getJson<any>(url, signal);
      endpoint = url;
      if (raw) break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!raw) throw lastErr instanceof Error ? lastErr : new Error("Линия Winline недоступна");

  const list: WlEvent[] = Array.isArray(raw) ? raw : raw.events || raw.data || raw.items || [];
  const out: BookEvent[] = [];
  for (const e of list) {
    let h = e.team1 || str(e.opponent1);
    let a = e.team2 || str(e.opponent2);
    if ((!h || !a) && e.name?.includes(" - ")) {
      const [x, y] = e.name.split(" - ");
      h = h || x?.trim();
      a = a || y?.trim();
    }
    if (!h || !a) continue;
    const markets = parseMarkets(e);
    if (!markets.moneyline.home && !markets.moneyline.away) continue;
    const eid = String(e.id ?? e.eventId ?? `${h}-${a}`);
    out.push({
      bookKey: "winline",
      bookTitle: "Винлайн",
      bookEventId: eid,
      sport,
      league: str(e.championship) || str(e.tournament) || "",
      home: h,
      away: a,
      startTime: parseTime(e.date ?? e.startDate),
      live: Boolean(e.isLive),
      url: `https://winline.ru/stavki/event/${eid}`,
      markets,
    });
  }
  return { events: out, endpoint, rawCount: list.length };
}

export const winline: BookAdapter = {
  key: "winline",
  title: "Винлайн",
  site: "https://winline.ru",
  sports: ["football", "hockey", "tennis", "basketball", "volleyball", "table_tennis", "mma", "esports"],
  fetchLine,
};
