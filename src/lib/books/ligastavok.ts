import type { BookAdapter, BookEvent, SportKey, TotalLine, HandicapLine } from "./types";
import { getJsonFirst, isoFrom, roundLine } from "./http";
import { RU_SPORT_MATCH } from "./platform";

/**
 * Лига Ставок. Официальное API витрины, которым пользуется сам сайт
 * ligastavok.ru: POST https://lds-api-sites.ligastavok.ru/rest/events/v8/eventsList
 *
 * Запрос (заголовки «мобильного приложения»):
 *   x-application-name: mobile, x-req-id: <uuid>
 *   тело: { gameId: [] (все виды спорта), limit, skip, view: "priority",
 *           proposedTypes: ["MAINOFFER"], ts }
 *
 * Ответ: { result: { data: [ { id, event: { team1, team2, gameTitle,
 *   tournamentTitle, startDate (мс), ns: "live" | "prematch" },
 *   outcomes: { <id>: { title, value, adValue } } } ] } }
 *   title: "1"/"X"/"2" — исходы; "Бол"/"Мен" — тотал (adValue — линия);
 *   "Ф1"/"Ф2" — фора (adValue — линия); "1X"/"12"/"X2" — двойной шанс.
 */

const API = "https://lds-api-sites.ligastavok.ru/rest/events/v8/eventsList";
const SITE = "https://www.ligastavok.ru";

/** событий на страницу запроса */
const PAGE_LIMIT = 250;
/** максимум страниц (1500 событий) — чтобы уложиться в таймаут сканера */
const MAX_PAGES = 6;

type LsOutcome = { title?: string; value?: number | string; adValue?: number | string };

/** поля события: внутри `event` (POST-ответ) или прямо в элементе (GET-ответ) */
type LsEventInfo = {
  team1?: string;
  team2?: string;
  gameTitle?: string;
  categoryTitle?: string;
  tournamentTitle?: string;
  tournament?: string;
  startDate?: number;
  startTime?: number;
  ns?: string;
};

type LsItem = LsEventInfo & {
  id?: number | string;
  event?: LsEventInfo;
  outcomes?: Record<string, LsOutcome>;
  markets?: Record<string, LsOutcome>[];
};
type LsResponse = { result?: { data?: LsItem[] }; events?: LsItem[]; data?: LsItem[] };

const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
  return Number.isFinite(n) && n > 1.01 && n < 1000 ? n : undefined;
};

const lineVal = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
  return Number.isFinite(n) && n !== 0 ? roundLine(n) : undefined;
};

function headers(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-application-name": "mobile",
    "x-req-id": crypto.randomUUID?.() ?? String(Date.now()),
    Accept: "*/*",
    "Accept-Language": "ru-RU,ru;q=0.9",
    Origin: SITE,
    Referer: `${SITE}/`,
    "User-Agent":
      "Mozilla/5.0 (Linux; Android 13; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36",
  };
}

/** Разбор исходов события в наши рынки */
export function parseOutcomes(outcomes: Record<string, LsOutcome> | undefined) {
  const ml: { home?: number; draw?: number; away?: number } = {};
  const dc: { homeDraw?: number; homeAway?: number; drawAway?: number } = {};
  const totalsMap = new Map<number, TotalLine>();
  const hcapMap = new Map<number, HandicapLine>();

  for (const o of Object.values(outcomes || {})) {
    const title = String(o?.title ?? "").toLowerCase().trim();
    const price = num(o?.value);
    if (!title || !price) continue;
    const line = lineVal(o?.adValue);

    if (title === "1" || title === "п1" || title === "w1") ml.home = price;
    else if (title === "x" || title === "х" || title === "ничья") ml.draw = price;
    else if (title === "2" || title === "п2" || title === "w2") ml.away = price;
    else if (title === "1x" || title === "1х") dc.homeDraw = price;
    else if (title === "12") dc.homeAway = price;
    else if (title === "x2" || title === "х2") dc.drawAway = price;
    else if (/^(бол|больше|over|тб)/.test(title) && line != null) {
      const t = totalsMap.get(line) || { line };
      t.over = price;
      totalsMap.set(line, t);
    } else if (/^(мен|меньше|under|тм)/.test(title) && line != null) {
      const t = totalsMap.get(line) || { line };
      t.under = price;
      totalsMap.set(line, t);
    } else if (/^(ф1|фора1|h1)/.test(title) && line != null) {
      const h = hcapMap.get(line) || { line };
      h.home = price;
      hcapMap.set(line, h);
    } else if (/^(ф2|фора2|h2)/.test(title) && line != null) {
      const signed = -line;
      const h = hcapMap.get(signed) || { line: signed };
      h.away = price;
      hcapMap.set(signed, h);
    }
  }

  return {
    moneyline: ml,
    doubleChance: dc,
    totals: [...totalsMap.values()].filter((t) => t.over && t.under).sort((a, b) => a.line - b.line),
    handicaps: [...hcapMap.values()].filter((h) => h.home && h.away).sort((a, b) => a.line - b.line),
  };
}

export function parseItem(item: LsItem, sport: SportKey): BookEvent | null {
  const ev: LsEventInfo = item.event ?? item;
  const home = ev.team1?.trim();
  const away = ev.team2?.trim();
  if (!home || !away) return null;

  const gameTitle = ev.gameTitle || "";
  if (gameTitle && !RU_SPORT_MATCH[sport].test(gameTitle)) return null;

  const markets = parseOutcomes(item.outcomes ?? item.markets?.[0]);
  if (!markets.moneyline.home && !markets.moneyline.away) return null;

  const startMs = ev.startDate ?? ev.startTime;
  const id = String(item.id ?? `${home}-${away}`);

  return {
    bookKey: "ligastavok",
    bookTitle: "Лига Ставок",
    bookEventId: id,
    sport,
    league: ev.tournamentTitle || ev.tournament || ev.categoryTitle || "",
    home,
    away,
    startTime: startMs ? isoFrom(startMs) : new Date().toISOString(),
    live: ev.ns === "live",
    url: SITE,
    markets,
  };
}

async function fetchLine(sport: SportKey, signal: AbortSignal) {
  const items: LsItem[] = [];
  let endpoint = API;

  for (let page = 0; page < MAX_PAGES; page++) {
    if (signal.aborted) break;
    // ts округляем до 20 секунд: тело запроса повторяется в пределах окна
    // кэша, и скан по нескольким видам спорта не качает страницы заново
    const ts = Math.floor(Date.now() / 20000) * 20000;
    const body = JSON.stringify({
      gameId: [],
      limit: PAGE_LIMIT,
      skip: page * PAGE_LIMIT,
      topEvents: false,
      ts,
      view: "priority",
      widgetVideo: false,
      proposedTypes: ["MAINOFFER"],
    });
    // getJsonFirst кэширует ответ: скан по нескольким видам спорта
    // не повторяет одни и те же страницы заново
    let loaded;
    try {
      loaded = await getJsonFirst<LsResponse>([API], signal, {
        headers: headers(),
        method: "POST",
        body,
        cacheKey: `ligastavok:${page}`,
        timeoutMs: 7000,
        isValid: (d) => {
          const b = d?.result?.data ?? d?.data ?? d?.events;
          return Array.isArray(b) && b.length > 0;
        },
      });
    } catch (e) {
      // часть страниц уже есть — отдаём её, а не падаем целиком
      if (signal.aborted || items.length) break;
      throw e;
    }
    endpoint = loaded.url;
    const batch = loaded.data?.result?.data ?? loaded.data?.data ?? loaded.data?.events ?? [];
    if (!batch.length) break;
    items.push(...batch);
    if (batch.length < PAGE_LIMIT) break;
  }

  if (!items.length) throw new Error("API Лиги Ставок не вернул событий");

  const out: BookEvent[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const parsed = parseItem(item, sport);
    if (!parsed) continue;
    if (seen.has(parsed.bookEventId)) continue;
    seen.add(parsed.bookEventId);
    out.push(parsed);
  }
  return { events: out, endpoint, rawCount: items.length };
}

export const ligastavok: BookAdapter = {
  key: "ligastavok",
  title: "Лига Ставок",
  site: SITE,
  sports: ["football", "hockey", "tennis", "basketball", "volleyball", "table_tennis", "mma", "esports"],
  fetchLine,
};
