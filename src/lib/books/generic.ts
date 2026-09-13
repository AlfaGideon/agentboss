import type { BookAdapter, BookEvent, SportKey, TotalLine, HandicapLine } from "./types";
import { getJson, roundLine } from "./http";

/**
 * Универсальный адаптер для российских контор с похожей структурой ответа.
 * Терпим к формату: перебирает зеркала и разбирает вложенные структуры
 * вида sports → tournaments → events → markets/outcomes.
 */

type AnyRec = Record<string, any>;

export type GenericConfig = {
  key: string;
  title: string;
  site: string;
  /** Список адресов-кандидатов; {sport} подставляется из sportParam */
  endpoints: (sport: SportKey) => string[];
  /** Как понять, что событие относится к нужному виду спорта */
  sportMatch: Record<SportKey, RegExp>;
  /** Ссылка на событие на сайте конторы */
  eventUrl?: (id: string) => string;
  headers?: Record<string, string>;
};

const num = (v: any): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) && n > 1.01 && n < 1000 ? n : undefined;
};

/** Рекурсивный сбор объектов, похожих на события */
function collect(node: any, acc: AnyRec[] = [], depth = 0): AnyRec[] {
  if (!node || depth > 7) return acc;
  if (Array.isArray(node)) {
    for (const n of node) collect(n, acc, depth + 1);
    return acc;
  }
  if (typeof node === "object") {
    const t1 = node.team1 ?? node.opp1 ?? node.home ?? node.homeTeam ?? node.opponent1 ?? node.player1;
    const t2 = node.team2 ?? node.opp2 ?? node.away ?? node.awayTeam ?? node.opponent2 ?? node.player2;
    if (t1 && t2) acc.push(node);
    else if (typeof node.name === "string" && / - | — |vs\.? /i.test(node.name) && hasOdds(node)) acc.push(node);
    for (const k of [
      "events", "matches", "items", "children", "tournaments", "leagues", "champs",
      "championships", "data", "sports", "result", "results", "list", "content", "lines",
    ]) {
      if (node[k]) collect(node[k], acc, depth + 1);
    }
  }
  return acc;
}

function hasOdds(e: AnyRec): boolean {
  if (Array.isArray(e.markets) || Array.isArray(e.outcomes) || Array.isArray(e.factors)) return true;
  return ["win1", "w1", "p1", "coef1", "1"].some((k) => num(e[k]) !== undefined);
}

const nameOf = (v: any): string =>
  typeof v === "string" ? v : v && typeof v === "object" ? String(v.name ?? v.title ?? v.caption ?? "") : "";

function parseTime(e: AnyRec): string {
  const raw = e.startTime ?? e.startDate ?? e.date ?? e.time ?? e.kickoff ?? e.dt;
  if (raw == null) return new Date().toISOString();
  if (typeof raw === "number") return new Date(raw > 1e12 ? raw : raw * 1000).toISOString();
  const d = new Date(String(raw));
  return isNaN(+d) ? new Date().toISOString() : d.toISOString();
}

/** Разбор котировок: и плоские поля, и массивы рынков */
export function parseOdds(e: AnyRec) {
  const ml: { home?: number; draw?: number; away?: number } = {};
  const dc: { homeDraw?: number; homeAway?: number; drawAway?: number } = {};
  const btts: { yes?: number; no?: number } = {};
  const totalsMap = new Map<number, TotalLine>();
  const hcapMap = new Map<number, HandicapLine>();

  // плоские поля
  ml.home = num(e.win1 ?? e.w1 ?? e.p1 ?? e.coef1 ?? e["1"]);
  ml.draw = num(e.draw ?? e.x ?? e.coefX ?? e["X"] ?? e["x"]);
  ml.away = num(e.win2 ?? e.w2 ?? e.p2 ?? e.coef2 ?? e["2"]);
  dc.homeDraw = num(e["1x"] ?? e["1X"] ?? e.win1draw);
  dc.homeAway = num(e["12"] ?? e.win1win2);
  dc.drawAway = num(e["x2"] ?? e["X2"] ?? e.drawwin2);

  const put = (rawName: string, price: number, param?: number) => {
    const n = rawName.toLowerCase().replace(/\s+/g, "");
    if (n === "1" || n === "п1" || n === "w1" || n === "home") ml.home = price;
    else if (n === "x" || n === "х" || n === "draw" || n === "ничья") ml.draw = price;
    else if (n === "2" || n === "п2" || n === "w2" || n === "away") ml.away = price;
    else if (n === "1x" || n === "1х") dc.homeDraw = price;
    else if (n === "12") dc.homeAway = price;
    else if (n === "x2" || n === "х2") dc.drawAway = price;
    else if (/^(тб|over|больше|б)/.test(n) && param != null) {
      const line = roundLine(param);
      const t = totalsMap.get(line) || { line };
      t.over = price;
      totalsMap.set(line, t);
    } else if (/^(тм|under|меньше|м)/.test(n) && param != null) {
      const line = roundLine(param);
      const t = totalsMap.get(line) || { line };
      t.under = price;
      totalsMap.set(line, t);
    } else if (/^(ф1|фора1|h1|hand1)/.test(n) && param != null) {
      const line = roundLine(param);
      const h = hcapMap.get(line) || { line };
      h.home = price;
      hcapMap.set(line, h);
    } else if (/^(ф2|фора2|h2|hand2)/.test(n) && param != null) {
      const line = roundLine(-param);
      const h = hcapMap.get(line) || { line };
      h.away = price;
      hcapMap.set(line, h);
    } else if (/обезабьют.*(да|yes)|btts.*yes/.test(n)) btts.yes = price;
    else if (/обезабьют.*(нет|no)|btts.*no/.test(n)) btts.no = price;
  };

  const walkMarkets = (arr: any[], marketName = "") => {
    for (const m of arr || []) {
      if (!m || typeof m !== "object") continue;
      const mname = (nameOf(m) || marketName).toLowerCase();
      const outs = m.outcomes ?? m.factors ?? m.odds ?? m.coefs ?? m.selections;
      if (Array.isArray(outs)) {
        walkMarkets(outs, mname);
        continue;
      }
      const price = num(m.value ?? m.coef ?? m.factor ?? m.odd ?? m.price ?? m.k);
      if (!price) continue;
      const param = Number(m.param ?? m.parameter ?? m.total ?? m.hcap ?? m.p ?? NaN);
      let oname = nameOf(m) || String(m.type ?? "");
      // название исхода иногда только в родительском рынке
      if (!oname && marketName) oname = marketName;
      if (/тотал/.test(mname) && !/^(тб|тм|б|м|over|under|больше|меньше)/i.test(oname)) {
        oname = /меньше|under/i.test(oname) ? "тм" : "тб";
      }
      put(oname, price, Number.isFinite(param) ? param : undefined);
    }
  };

  for (const key of ["markets", "outcomes", "factors", "odds", "coefs"]) {
    if (Array.isArray(e[key])) walkMarkets(e[key]);
  }

  return {
    moneyline: ml,
    doubleChance: dc,
    btts,
    totals: [...totalsMap.values()].filter((t) => t.over && t.under).sort((a, b) => a.line - b.line),
    handicaps: [...hcapMap.values()].filter((h) => h.home && h.away).sort((a, b) => a.line - b.line),
  };
}

export function makeAdapter(cfg: GenericConfig): BookAdapter {
  return {
    key: cfg.key,
    title: cfg.title,
    site: cfg.site,
    sports: ["football", "hockey", "tennis", "basketball", "volleyball", "table_tennis", "mma", "esports"],
    async fetchLine(sport: SportKey, signal: AbortSignal) {
      let raw: any = null;
      let endpoint = "";
      let lastErr: unknown = null;
      for (const url of cfg.endpoints(sport)) {
        try {
          raw = await getJson<any>(url, signal, cfg.headers);
          endpoint = url;
          if (raw) break;
        } catch (e) {
          lastErr = e;
        }
      }
      if (!raw) throw lastErr instanceof Error ? lastErr : new Error(`Линия «${cfg.title}» недоступна`);

      const all = collect(raw);
      const re = cfg.sportMatch[sport];
      const out: BookEvent[] = [];
      for (const e of all) {
        const sportName = String(
          e.sportName ?? e.sport ?? e.sport_name ?? e.sportTitle ?? e.kind ?? ""
        );
        if (sportName && re && !re.test(sportName)) continue;

        let home = nameOf(e.team1 ?? e.opp1 ?? e.home ?? e.homeTeam ?? e.opponent1 ?? e.player1);
        let away = nameOf(e.team2 ?? e.opp2 ?? e.away ?? e.awayTeam ?? e.opponent2 ?? e.player2);
        if ((!home || !away) && typeof e.name === "string") {
          const parts = e.name.split(/ - | — | vs\.? /i);
          if (parts.length === 2) {
            home = home || parts[0].trim();
            away = away || parts[1].trim();
          }
        }
        if (!home || !away) continue;

        const markets = parseOdds(e);
        if (!markets.moneyline.home && !markets.moneyline.away) continue;

        const id = String(e.id ?? e.eventId ?? e.matchId ?? `${home}-${away}`);
        out.push({
          bookKey: cfg.key,
          bookTitle: cfg.title,
          bookEventId: id,
          sport,
          league: nameOf(e.tournament ?? e.league ?? e.champName ?? e.championship ?? e.competition),
          home,
          away,
          startTime: parseTime(e),
          live: Boolean(e.isLive ?? e.live ?? e.inplay),
          url: cfg.eventUrl ? cfg.eventUrl(id) : cfg.site,
          markets,
        });
      }
      return { events: out, endpoint, rawCount: all.length };
    },
  };
}

/** Общие регулярки видов спорта для русских контор */
export const RU_SPORT_MATCH: Record<SportKey, RegExp> = {
  football: /футбол/i,
  hockey: /хоккей/i,
  tennis: /^теннис|большой теннис/i,
  basketball: /баскетбол/i,
  volleyball: /волейбол/i,
  table_tennis: /настольный теннис/i,
  mma: /mma|бокс|смешанн|единоборств/i,
  esports: /кибер|dota|counter|lol|league of legends/i,
};
