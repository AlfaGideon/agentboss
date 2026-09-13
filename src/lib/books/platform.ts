import type { BookAdapter, BookEvent, BookFetchAttempt, SportKey, TotalLine, HandicapLine } from "./types";
import { getJsonFirst, isoFrom, roundLine } from "./http";

/**
 * Единая платформа линии, на которой работают Фонбет, Марафон (РФ), ПАРИ и
 * Беттери: фиды `https://lineNN.{код}-resources.com/events/listBase` (прематч)
 * и `/events/list` (лайв). Это те же официальные публичные фиды, которыми
 * пользуются сайты самих контор — один JSON содержит всю линию целиком.
 *
 * Схема ответа:
 *   sports:        [{id, name, parentId}] — дерево «вид спорта → лига»
 *   events:        [{id, sportId, team1, team2, startTime (сек), place?, parentId?}]
 *   customFactors: [{e: id события, factors: [{f: код, v: коэффициент, pt|p: линия}]}]
 *
 * Коды факторов (проверены по независимым парсерам платформы):
 *   921/922/923 — П1 / Х / П2
 *   930/931     — тотал больше / меньше (линия в pt, либо p/100)
 *   910, 989, 1569, 927, 1672, 1677, 1680 — фора 1 (линия в pt, со знаком)
 *   912, 991, 1572, 928, 1675, 1678, 1681 — фора 2
 */

/** Соответствие русских названий видов спорта нашим ключам */
export const RU_SPORT_MATCH: Record<SportKey, RegExp> = {
  football: /футбол/i,
  hockey: /хоккей/i,
  tennis: /^теннис|большой теннис/i,
  basketball: /баскетбол/i,
  volleyball: /волейбол/i,
  table_tennis: /настольный теннис/i,
  mma: /mma|бокс|смешанн|единоборств/i,
  esports: /кибер|dota|counter|lol|league of legends|cs/i,
};

type PlatSport = { id: number; name: string; parentId?: number };
type PlatEvent = {
  id: number;
  sportId: number;
  team1?: string;
  team2?: string;
  startTime?: number;
  name?: string;
  namePrefix?: string;
  parentId?: number;
  level?: number;
  place?: string;
};
type PlatFactor = { f: number; v: number; p?: number; pt?: number };
type PlatBlock = { e: number; factors?: PlatFactor[] };
export type PlatLine = {
  sports?: PlatSport[];
  events?: PlatEvent[];
  customFactors?: PlatBlock[];
};

const HCAP1 = new Set([910, 989, 1569, 927, 1672, 1677, 1680, 1913, 924]);
const HCAP2 = new Set([912, 991, 1572, 928, 1675, 1678, 1681, 1914, 925]);
const TOTAL_OVER = 930;
const TOTAL_UNDER = 931;
const W1 = 921;
const DRAW = 922;
const W2 = 923;

/** Линия фактора: pt уже готовое значение, p — обычно значение ×100 */
function factorLine(f: PlatFactor): number | undefined {
  if (f.pt != null && Number.isFinite(f.pt)) return roundLine(f.pt);
  if (f.p != null && Number.isFinite(f.p) && f.p !== 0) return roundLine(f.p / 100);
  return undefined;
}

/** Разбор фида платформы в события одной конторы по одному виду спорта */
export function parsePlatformLine(
  data: PlatLine,
  cfg: { key: string; title: string; eventUrl: (sportId: number, id: number) => string },
  sport: SportKey,
  feedIsLive: boolean
): BookEvent[] {
  const sports = data.sports || [];
  const byId = new Map(sports.map((s) => [s.id, s]));
  const rootName = (sportId: number): string => {
    let cur = byId.get(sportId);
    let guard = 0;
    while (cur?.parentId && byId.get(cur.parentId) && guard++ < 12) cur = byId.get(cur.parentId)!;
    return cur?.name || "";
  };
  const leagueName = (sportId: number): string => byId.get(sportId)?.name || "";

  const re = RU_SPORT_MATCH[sport];
  const events = data.events || [];

  const factors = new Map<number, PlatFactor[]>();
  for (const b of data.customFactors || []) {
    if (b?.e != null && b.factors?.length) factors.set(b.e, b.factors);
  }

  const out: BookEvent[] = [];
  for (const ev of events) {
    // только матчи верхнего уровня (дочерние росписи имеют parentId)
    if (ev.parentId) continue;
    if (!ev.team1 || !ev.team2) continue;
    if (!re.test(rootName(ev.sportId))) continue;
    const fs = factors.get(ev.id);
    if (!fs?.length) continue;

    const val = (code: number) => fs.find((f) => f.f === code)?.v;
    const totalsMap = new Map<number, TotalLine>();
    const hcapMap = new Map<number, HandicapLine>();
    for (const f of fs) {
      if (f.v == null || f.v <= 1) continue;
      if (f.f === TOTAL_OVER || f.f === TOTAL_UNDER) {
        const line = factorLine(f);
        if (line == null) continue;
        const t = totalsMap.get(line) || { line };
        if (f.f === TOTAL_OVER) t.over = f.v;
        else t.under = f.v;
        totalsMap.set(line, t);
      } else if (HCAP1.has(f.f) || HCAP2.has(f.f)) {
        const line = factorLine(f);
        if (line == null) continue;
        // фора хозяев со знаком как есть; для гостей — зеркальная
        const signed = HCAP1.has(f.f) ? line : -line;
        const h = hcapMap.get(signed) || { line: signed };
        if (HCAP1.has(f.f)) h.home = f.v;
        else h.away = f.v;
        hcapMap.set(signed, h);
      }
    }

    const moneyline = { home: val(W1), draw: val(DRAW), away: val(W2) };
    if (!moneyline.home && !moneyline.away) continue;

    out.push({
      bookKey: cfg.key,
      bookTitle: cfg.title,
      bookEventId: String(ev.id),
      sport,
      league: leagueName(ev.sportId) || ev.namePrefix || "",
      home: ev.team1,
      away: ev.team2,
      startTime: ev.startTime ? isoFrom(ev.startTime) : new Date().toISOString(),
      live: feedIsLive || ev.place === "live",
      url: cfg.eventUrl(ev.sportId, ev.id),
      markets: {
        moneyline,
        totals: [...totalsMap.values()]
          .filter((t) => t.over && t.under)
          .sort((a, b) => a.line - b.line),
        handicaps: [...hcapMap.values()]
          .filter((h) => h.home && h.away)
          .sort((a, b) => a.line - b.line),
      },
    });
  }
  return out;
}

export type PlatformConfig = {
  key: string;
  title: string;
  site: string;
  /** scopeMarket конторы на платформе (у каждой свой) */
  scopeMarket: number;
  /** адреса-зеркала фида */
  hosts: string[];
  /** дополнительные адреса прематча (например, старый currentLine у Фонбета) */
  extraPreUrls?: string[];
  /** префикс пути у части зеркал (у Фонбета часть отдаёт /ma/events/...) */
  pathPrefixes?: string[];
  eventUrl: (sportId: number, id: number) => string;
};

const urlsFor = (hosts: string[], prefixes: string[], scopeMarket: number, kind: "listBase" | "list") =>
  hosts.flatMap((h) =>
    prefixes.map(
      (p) => `https://${h}${p}/events/${kind}?lang=ru&scopeMarket=${scopeMarket}`
    )
  );

/**
 * Забрать линию конторы на платформе: прематч + лайв двумя запросами.
 * Лайв-события дедуплицируются с прематчем по идентификатору.
 */
export async function fetchPlatformLine(
  cfg: PlatformConfig,
  sport: SportKey,
  signal: AbortSignal
): Promise<{
  events: BookEvent[];
  endpoint: string;
  rawCount: number;
  dnsVia?: string;
  insecure?: boolean;
  tried?: BookFetchAttempt[];
}> {
  const prefixes = cfg.pathPrefixes?.length ? cfg.pathPrefixes : [""];
  const preUrls = [...(cfg.extraPreUrls || []), ...urlsFor(cfg.hosts, prefixes, cfg.scopeMarket, "listBase")];
  const liveUrls = urlsFor(cfg.hosts, prefixes, cfg.scopeMarket, "list");

  const pre = await getJsonFirst<PlatLine>(preUrls, signal, {
    cacheKey: `${cfg.key}:pre`,
    isValid: (d) => Boolean(d?.events?.length),
  });

  let events = parsePlatformLine(pre.data, cfg, sport, false);
  let endpoint = pre.url;
  let rawCount = pre.data.events?.length ?? 0;
  let dnsVia = pre.dnsVia;
  let insecure = pre.insecure;

  // старый фид currentLine (Фонбет) уже содержит и лайв, и прематч одним файлом
  if (pre.url.includes("currentLine")) {
    return { events, endpoint, rawCount, dnsVia, insecure, tried: pre.tried };
  }

  // лайв: отдельный фид; события с тем же id заменяют прематч-версию
  let liveEvents: BookEvent[] = [];
  try {
    const live = await getJsonFirst<PlatLine>(liveUrls, signal, {
      cacheKey: `${cfg.key}:live`,
      isValid: (d) => Boolean(d?.events?.length),
    });
    liveEvents = parsePlatformLine(live.data, cfg, sport, true);
    endpoint = `${pre.url} + ${live.url}`;
    rawCount += live.data.events?.length ?? 0;
  } catch {
    /* лайв-фид недоступен — остаётся прематч */
  }

  const seen = new Set(liveEvents.map((e) => e.bookEventId));
  events = events.filter((e) => !seen.has(e.bookEventId));
  const merged = [...liveEvents, ...events];

  return { events: merged, endpoint, rawCount, dnsVia, insecure, tried: pre.tried };
}

/** Адаптер конторы на платформе (Марафон, ПАРИ, Беттери) */
export function makePlatformAdapter(cfg: PlatformConfig): BookAdapter {
  return {
    key: cfg.key,
    title: cfg.title,
    site: cfg.site,
    sports: ["football", "hockey", "tennis", "basketball", "volleyball", "table_tennis", "mma", "esports"],
    fetchLine: (sport, signal) => fetchPlatformLine(cfg, sport, signal),
  };
}
