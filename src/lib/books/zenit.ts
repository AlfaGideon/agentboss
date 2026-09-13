import type { BookAdapter, BookEvent, SportKey, TotalLine, HandicapLine } from "./types";
import { getJsonFirst, roundLine } from "./http";

/**
 * Зенит (zenit.win). Официальный AJAX-фид линии, которым пользуется сам сайт:
 *
 *   прематч: https://zenit.win/ajax/line/printer/react?...sport={id}&length=1000
 *   лайв:    https://zenit.win/ajax/live/printer/react
 *
 * API требует заголовки `imprinthash` и `frontversion` (отпечаток фронтенда
 * сайта); без них отвечает {"errorCode":400}. Значения можно переопределить
 * переменными окружения ZENIT_IMPRINT_HASH / ZENIT_FRONT_VERSION.
 *
 * Ответ:
 *   games: { id: { c1_id, c2_id, tid, sid, date: "YYYY-MM-DD HH:MM:SS" (МСК),
 *                  hd: [{n: "1"|"X"|"2"|"М"|"Б"}], f_l: [{o, h}] } }
 *   dict:  { cmd: {id: название команды}, tournament: {id: {name}} }
 *
 * Коды исходов в f_l: 1 — П1, 2 — Х, 3 — П2, 9 — ТМ, 10 — ТБ, 7 — Ф1, 8 — Ф2.
 * Значение линии тотала/форы идёт соседним элементом массива (подход сверен
 * с рабочими парсерами фида).
 */

const LINE_URL = "https://zenit.win/ajax/line/printer/react";
const LIVE_URL = "https://zenit.win/ajax/live/printer/react";

const IMPRINT_HASH = process.env.ZENIT_IMPRINT_HASH || "d01d68e5a9775b90a0c7239e7f078895";
const FRONT_VERSION = process.env.ZENIT_FRONT_VERSION || "1.72.1";

/** id видов спорта у Зенита; ММА и бокс идут отдельными разделами */
const SPORT_IDS: Record<SportKey, number[]> = {
  football: [1],
  hockey: [2],
  basketball: [3],
  volleyball: [4],
  tennis: [5],
  table_tennis: [6],
  esports: [7],
  mma: [13, 14],
};

const SPORT_PATH: Record<number, string> = {
  1: "football",
  2: "hockey",
  3: "basketball",
  4: "volleyball",
  5: "tennis",
  6: "table-tennis",
  7: "esports",
  13: "mma",
  14: "boxing",
};

type ZnBet = { o?: string; h?: string | number };
type ZnGame = {
  c1_id?: string | number;
  c2_id?: string | number;
  tid?: string | number;
  sid?: string | number;
  date?: string | number;
  hd?: { n?: string }[];
  f_l?: ZnBet[];
};
type ZnLine = {
  games?: Record<string, ZnGame>;
  dict?: {
    cmd?: Record<string, string>;
    tournament?: Record<string, { name?: string } | string>;
  };
};

const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
  return Number.isFinite(n) && n > 1.01 && n < 1000 ? n : undefined;
};

/** «YYYY-MM-DD HH:MM:SS» по Москве → ISO */
function parseDate(raw: string | number | undefined): string {
  if (typeof raw === "number") return new Date(raw > 1e12 ? raw : raw * 1000).toISOString();
  if (typeof raw === "string") {
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
    if (m) {
      // timezone=3 в запросе: время московское
      const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 3, +m[5]));
      if (!isNaN(+d)) return d.toISOString();
    }
    const d = new Date(raw);
    if (!isNaN(+d)) return d.toISOString();
  }
  return new Date().toISOString();
}

/** коды f_l, которые несут коэффициенты (остальное — значения линий) */
const ODDS_CODES = new Set(["1", "2", "3", "7", "8", "9", "10"]);

/**
 * Значение линии из соседних элементов f_l (для ТБ/ТМ и фор).
 * Линия идёт отдельным элементом с «служебным» кодом рядом с исходами
 * (обычно [линия, ТБ, ТМ]); ищем ближайший «служебный» элемент в обе стороны.
 */
function adjacentLine(bets: ZnBet[], index: number, preferPrevious: boolean): number | undefined {
  const order = preferPrevious
    ? [index - 1, index - 2, index + 1, index + 2]
    : [index + 1, index + 2, index - 1, index - 2];
  let fallback: number | undefined;
  for (const i of order) {
    const bet = bets[i];
    if (!bet) continue;
    const v = num(bet.h);
    if (v == null || v >= 30) continue;
    const code = String(bet.o ?? "");
    if (!ODDS_CODES.has(code)) return roundLine(v);
    if (fallback == null) fallback = v;
  }
  return fallback != null ? roundLine(fallback) : undefined;
}

export function parseGame(
  id: string,
  game: ZnGame,
  teams: Record<string, string>,
  tournaments: Record<string, { name?: string } | string>,
  sport: SportKey,
  live: boolean
): BookEvent | null {
  const home = String(teams[String(game.c1_id)] ?? "").trim();
  const away = String(teams[String(game.c2_id)] ?? "").trim();
  if (!home || !away) return null;

  const bets = game.f_l || [];
  const headers = (game.hd || []).map((x) => String(x.n ?? "").trim());

  const ml: { home?: number; draw?: number; away?: number } = {};
  const totalsMap = new Map<number, TotalLine>();
  const hcapMap = new Map<number, HandicapLine>();

  for (let i = 0; i < bets.length; i++) {
    const bet = bets[i];
    const code = String(bet.o ?? "");
    const price = num(bet.h);
    if (!price) continue;
    const header = headers[i] ?? "";

    if (code === "1" && (header === "1" || !header)) ml.home = price;
    else if (code === "3" && (header === "2" || !header)) ml.away = price;
    else if (code === "2") {
      // «2» — ничья в трёхисходных и П2 в двухисходных рынках:
      // ориентируемся на заголовок колонки и наличие исхода с кодом 3
      if (header === "2") ml.away = price;
      else if (!header && !bets.some((b) => String(b?.o) === "3")) ml.away = price;
      else ml.draw = price;
    }
    else if (code === "10") {
      const line = adjacentLine(bets, i, true);
      if (line != null) {
        const t = totalsMap.get(line) || { line };
        t.over = price;
        totalsMap.set(line, t);
      }
    } else if (code === "9") {
      const line = adjacentLine(bets, i, false);
      if (line != null) {
        const t = totalsMap.get(line) || { line };
        t.under = price;
        totalsMap.set(line, t);
      }
    } else if (code === "7") {
      const line = adjacentLine(bets, i, true);
      if (line != null) {
        const h = hcapMap.get(line) || { line };
        h.home = price;
        hcapMap.set(line, h);
      }
    } else if (code === "8") {
      const line = adjacentLine(bets, i, true);
      if (line != null) {
        const signed = -line;
        const h = hcapMap.get(signed) || { line: signed };
        h.away = price;
        hcapMap.set(signed, h);
      }
    }
  }

  // в двухисходных видах П2 может идти кодом "2"
  if (!ml.away && ml.draw && !headers.some((h) => h === "X" || h === "Х")) {
    ml.away = ml.draw;
    ml.draw = undefined;
  }
  if (!ml.home || !ml.away) return null;

  const tidKey = String(game.tid ?? "");
  const tourn = tournaments[tidKey];
  const league =
    (typeof tourn === "string" ? tourn : tourn?.name) || "";

  return {
    bookKey: "zenit",
    bookTitle: "Зенит",
    bookEventId: `zenit-${id}`,
    sport,
    league,
    home,
    away,
    startTime: parseDate(game.date),
    live,
    url: "https://zenit.win/",
    markets: {
      moneyline: ml,
      // берём только согласованные пары: линия ТБ совпала с линией ТМ
      totals: [...totalsMap.values()]
        .filter((t) => t.over && t.under)
        .sort((a, b) => a.line - b.line),
      handicaps: [...hcapMap.values()].filter((h) => h.home && h.away).sort((a, b) => a.line - b.line),
    },
  };
}

export function parseLine(data: ZnLine, sport: SportKey, live: boolean): BookEvent[] {
  const games = data?.games || {};
  const teams = data?.dict?.cmd || {};
  const tournaments = (data?.dict?.tournament || {}) as Record<string, { name?: string } | string>;
  const out: BookEvent[] = [];
  for (const [id, game] of Object.entries(games)) {
    if (!game || typeof game !== "object") continue;
    const parsed = parseGame(id, game, teams, tournaments, sport, live);
    if (parsed) out.push(parsed);
  }
  return out;
}

const isValid = (d: ZnLine) => Boolean(d?.games && Object.keys(d.games).length > 0);

async function fetchLine(sport: SportKey, signal: AbortSignal) {
  const ids = SPORT_IDS[sport];
  if (!ids?.length) return { events: [], endpoint: "", rawCount: 0 };

  const events: BookEvent[] = [];
  let endpoint = "";
  let rawCount = 0;
  let dnsVia: string | undefined;
  let insecure: boolean | undefined;
  const tried: any[] = [];
  let lastError: unknown = null;

  for (const sportId of ids) {
    if (signal.aborted) break;
    const params = new URLSearchParams({
      all: "1",
      onlyview: "1",
      timeline: "0",
      tournaments_mode: "1",
      sport: String(sportId),
      tournament: "",
      tournament_region: "",
      tournament_info: "",
      league: "",
      games: "",
      ross: "0",
      lang_id: "1",
      timezone: "3",
      offset: "0",
      show_from_main: "0",
      client_v: "",
      length: "1000",
      sort_mode: "2",
      b_id: "",
      popular: "0",
    });
    const headers = {
      "X-Requested-With": "XMLHttpRequest",
      imprinthash: IMPRINT_HASH,
      frontversion: FRONT_VERSION,
      Referer: `https://zenit.win/line/${SPORT_PATH[sportId] ?? "football"}`,
    };

    // прематч; у ММА и бокса разделы разные — сбой одного не роняет другой
    try {
      const pre = await getJsonFirst<ZnLine>([`${LINE_URL}?${params}`], signal, {
        headers,
        cacheKey: `zenit:pre:${sportId}`,
        isValid,
      });
      endpoint = endpoint || pre.url;
      rawCount += Object.keys(pre.data.games || {}).length;
      dnsVia = dnsVia || pre.dnsVia;
      insecure = insecure || pre.insecure;
      tried.push(...(pre.tried || []));
      events.push(...parseLine(pre.data, sport, false));
    } catch (e) {
      if (signal.aborted) break;
      lastError = e;
      continue;
    }

    // лайв
    try {
      const live = await getJsonFirst<ZnLine>([`${LIVE_URL}?${params}`], signal, {
        headers: { ...headers, Referer: `https://zenit.win/live/${SPORT_PATH[sportId] ?? "football"}` },
        cacheKey: `zenit:live:${sportId}`,
        isValid,
      });
      rawCount += Object.keys(live.data.games || {}).length;
      const liveEvents = parseLine(live.data, sport, true);
      const seen = new Set(events.map((e) => e.bookEventId));
      events.push(...liveEvents.filter((e) => !seen.has(e.bookEventId)));
    } catch {
      /* лайв недоступен — остаётся прематч */
    }
  }

  if (!events.length) {
    if (lastError) throw lastError;
    throw new Error("Фид Зенита не вернул событий (проверьте imprinthash)");
  }
  return { events, endpoint, rawCount, dnsVia, insecure, tried };
}

export const zenit: BookAdapter = {
  key: "zenit",
  title: "Зенит",
  site: "https://zenit.win",
  sports: ["football", "hockey", "tennis", "basketball", "volleyball", "table_tennis", "mma", "esports"],
  fetchLine,
};
