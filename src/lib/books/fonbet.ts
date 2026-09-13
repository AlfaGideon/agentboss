import type { BookAdapter, BookEvent, SportKey, TotalLine, HandicapLine } from "./types";
import { getJson, isoFrom, roundLine } from "./http";

/**
 * Фонбет. Публичный фид линии (используется сайтом fon.bet).
 * Зеркала líne*.bkfon-resources.com отдают весь список событий и котировок одним JSON.
 */

const MIRRORS = [
  "https://line-static01.bkfon-resources.com/line/currentLine/ru/0.json.gz",
  "https://line11.bkfon-resources.com/line/currentLine/ru/0.json",
  "https://line-static01.bkfon-resources.com/line/currentLine/ru/0.json",
  "https://clientsapi21.bk6bba-resources.com/results/results.json.php",
];

type FonSport = { id: number; kind?: string; name: string; parentId?: number; sortOrder?: number };
type FonEvent = {
  id: number;
  sportId: number;
  team1?: string;
  team2?: string;
  team1Id?: number;
  team2Id?: number;
  startTime?: number;
  name?: string;
  namePrefix?: string;
  parentId?: number;
  level?: number;
  place?: string; // "live" для лайва
};
type FonFactor = { e: number; f: number; v: number; p?: number; pt?: number };
type FonBlock = { e: number; factors?: FonFactor[] };
type FonLine = {
  sports?: FonSport[];
  events?: FonEvent[];
  customFactors?: FonBlock[];
  eventMiscs?: { id: number; sportId: number }[];
};

// Соответствие видов спорта Фонбета
const SPORT_MATCH: Record<SportKey, RegExp> = {
  football: /^футбол$/i,
  hockey: /^хоккей$/i,
  tennis: /^теннис$/i,
  basketball: /^баскетбол$/i,
  volleyball: /^волейбол$/i,
  table_tennis: /настольный теннис/i,
  mma: /^(mma|смешанные|бокс)/i,
  esports: /киберспорт|counter|dota|league of legends/i,
};

/**
 * Коды исходов Фонбета (поле f у фактора):
 * 921 — П1, 922 — Х, 923 — П2 (основной исход матча)
 * 927/928 — 1X / X2, 1571 — 12
 * 930/931 — тотал больше/меньше (значение линии в pt)
 * 926/... — форы
 */
const F = {
  W1: 921,
  DRAW: 922,
  W2: 923,
  D1X: 927,
  D12: 1571,
  DX2: 928,
  TOTAL_OVER: 930,
  TOTAL_UNDER: 931,
  HANDICAP1: 927 /* placeholder, уточняется ниже */,
  BTTS_YES: 4172,
  BTTS_NO: 4173,
};

// Форы у Фонбета: 1913 (Ф1) и 1914 (Ф2) в новых версиях линии
const HCAP1 = new Set([1913, 924]);
const HCAP2 = new Set([1914, 925]);

async function fetchLine(sport: SportKey, signal: AbortSignal) {
  let data: FonLine | null = null;
  let endpoint = "";
  let lastErr: unknown = null;
  for (const url of MIRRORS) {
    try {
      data = await getJson<FonLine>(url, signal);
      endpoint = url;
      if (data?.events?.length) break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!data?.events?.length) {
    throw lastErr instanceof Error ? lastErr : new Error("Фид Фонбета недоступен");
  }

  const sports = data.sports || [];
  const byId = new Map(sports.map((s) => [s.id, s]));
  // корневой вид спорта для любого id (поднимаемся по parentId)
  const rootName = (sportId: number): string => {
    let cur = byId.get(sportId);
    let guard = 0;
    while (cur?.parentId && byId.get(cur.parentId) && guard++ < 12) cur = byId.get(cur.parentId)!;
    return cur?.name || "";
  };
  const leagueName = (sportId: number): string => byId.get(sportId)?.name || "";

  const re = SPORT_MATCH[sport];
  const events = data.events || [];
  const evById = new Map(events.map((e) => [e.id, e]));

  // факторы по событию
  const factors = new Map<number, FonFactor[]>();
  for (const b of data.customFactors || []) {
    if (b?.e != null && b.factors?.length) factors.set(b.e, b.factors);
  }

  const out: BookEvent[] = [];
  for (const ev of events) {
    // только матчи верхнего уровня (у дочерних росписей есть parentId)
    if (ev.parentId) continue;
    if (!ev.team1 || !ev.team2) continue;
    if (!re.test(rootName(ev.sportId))) continue;
    const fs = factors.get(ev.id);
    if (!fs?.length) continue;

    const val = (code: number) => fs.find((f) => f.f === code)?.v;
    const totalsMap = new Map<number, TotalLine>();
    const hcapMap = new Map<number, HandicapLine>();
    for (const f of fs) {
      const pt = f.pt ?? f.p;
      if (f.f === F.TOTAL_OVER || f.f === F.TOTAL_UNDER) {
        if (pt == null) continue;
        const line = roundLine(pt);
        const t = totalsMap.get(line) || { line };
        if (f.f === F.TOTAL_OVER) t.over = f.v;
        else t.under = f.v;
        totalsMap.set(line, t);
      } else if (HCAP1.has(f.f) || HCAP2.has(f.f)) {
        if (pt == null) continue;
        const line = roundLine(HCAP1.has(f.f) ? pt : -pt);
        const h = hcapMap.get(line) || { line };
        if (HCAP1.has(f.f)) h.home = f.v;
        else h.away = f.v;
        hcapMap.set(line, h);
      }
    }

    const moneyline = {
      home: val(F.W1),
      draw: val(F.DRAW),
      away: val(F.W2),
    };
    if (!moneyline.home && !moneyline.away) continue;

    out.push({
      bookKey: "fonbet",
      bookTitle: "Фонбет",
      bookEventId: String(ev.id),
      sport,
      league: leagueName(ev.sportId),
      home: ev.team1,
      away: ev.team2,
      startTime: ev.startTime ? isoFrom(ev.startTime) : new Date().toISOString(),
      live: ev.place === "live",
      url: `https://fon.bet/sports/${ev.sportId}/${ev.id}`,
      markets: {
        moneyline,
        doubleChance: {
          homeDraw: val(F.D1X),
          homeAway: val(F.D12),
          drawAway: val(F.DX2),
        },
        btts: { yes: val(F.BTTS_YES), no: val(F.BTTS_NO) },
        totals: [...totalsMap.values()]
          .filter((t) => t.over && t.under)
          .sort((a, b) => a.line - b.line),
        handicaps: [...hcapMap.values()]
          .filter((h) => h.home && h.away)
          .sort((a, b) => a.line - b.line),
      },
    });
  }

  return { events: out, endpoint, rawCount: events.length };
}

export const fonbet: BookAdapter = {
  key: "fonbet",
  title: "Фонбет",
  site: "https://fon.bet",
  sports: ["football", "hockey", "tennis", "basketball", "volleyball", "table_tennis", "mma", "esports"],
  fetchLine,
};
