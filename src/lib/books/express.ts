import type { MergedEvent } from "./types";
import { marketViews } from "./analyze";
import { normalizeProbs, shinProbs } from "../math";

/**
 * Экспрессы под Винлайн.
 *
 * У Винлайна нет публичного фида линии (см. README), поэтому котировки ног
 * берём как лучшую цену среди контор сканера, а «гарантию» (вероятность
 * прохода экспресса) считаем как произведение справедливых вероятностей ног —
 * консенсус российских контор с удалённой маржей (Shin или пропорциональный
 * метод, то же ядро, что в value-ставках).
 *
 * Важное ограничение: в экспресс входит максимум одна нога на матч — исходы
 * внутри одного матча коррелируют, и произведение вероятностей для них уже
 * не было бы честной оценкой.
 */

/** Одна нога экспресса: исход одного рынка одного матча */
export type ExpressLeg = {
  eventId: string;
  sport: string;
  league: string;
  match: string;
  startTime: string;
  live: boolean;
  market: string;
  marketLabel: string;
  /** человекочитаемый исход: «П1 — Зенит», «Больше 2.5», «1X» */
  outcome: string;
  /** контора с лучшей ценой */
  book: string;
  bookKey: string;
  url?: string;
  /** лучшая цена на рынке (цена, которую берём в экспресс) */
  price: number;
  /** справедливая вероятность с удалённой маржей, 0..1 */
  fairProb: number;
  /** сколько контор вошло в консенсус */
  booksCount: number;
};

export type Express = {
  legs: ExpressLeg[];
  /** произведение коэффициентов ног */
  totalOdds: number;
  /** гарантия: произведение справедливых вероятностей ног, в % */
  guaranteedPct: number;
  /** вероятность самой слабой ноги, в % */
  minLegProbPct: number;
  payout100: number;
  profit100: number;
};

export type ExpressOptions = {
  /** минимальная гарантия экспресса, % — по умолчанию 80 */
  minGuaranteePct?: number;
  /** минимум ног — по умолчанию 2 */
  minLegs?: number;
  /** максимум ног — по умолчанию 5 */
  maxLegs?: number;
  /** минимальная вероятность одной ноги (0..1) — по умолчанию 0.5 */
  minLegProb?: number;
  /** максимальная вероятность одной ноги (0..1) — почти наверняка исходы не берём */
  maxLegProb?: number;
  /** минимальный коэффициент одной ноги */
  minLegOdds?: number;
  /** минимальный коэффициент экспресса целиком */
  minTotalOdds?: number;
  /** максимальный коэффициент экспресса целиком */
  maxTotalOdds?: number;
  /** сколько контор нужно в консенсусе для ноги */
  minBooks?: number;
  method?: "shin" | "multiplicative";
  /** сколько экспрессов вернуть */
  limit?: number;
};

export type ExpressStats = {
  eventsScanned: number;
  /** матчей, сравнимых по числу контор */
  comparable: number;
  /** ног-кандидатов после фильтров */
  candidateLegs: number;
  /** сколько комбинаций дофильтровано по гарантии */
  combosChecked: number;
};

export type ExpressResult = {
  expresses: Express[];
  /** лучшие экспрессы чуть ниже порога — чтобы было видно, что рядом */
  nearMisses: Express[];
  stats: ExpressStats;
};

type Candidate = ExpressLeg;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Ноги-кандидаты: по каждому рынку каждого матча берём лучшую цену и
 * справедливую вероятность как консенсус контор (маржа снимается у каждой
 * отдельно, затем вероятности усредняются — как в findRuValue).
 */
export function candidateLegs(
  events: MergedEvent[],
  method: "shin" | "multiplicative" = "shin",
  minBooks = 3
): Candidate[] {
  const out: Candidate[] = [];
  for (const ev of events) {
    if (ev.books.length < minBooks) continue;
    for (const v of marketViews(ev, method)) {
      const perOutcome = new Map<string, number[]>();
      let counted = 0;
      for (const b of ev.books) {
        const prices = v.outcomes.map((o) => o.all.find((p) => p.bookKey === b.bookKey)?.price);
        if (prices.some((p) => !p)) continue;
        const probs =
          method === "shin" ? shinProbs(prices as number[]) : normalizeProbs(prices as number[]);
        v.outcomes.forEach((o, i) => {
          const arr = perOutcome.get(o.key) || [];
          arr.push(probs[i]);
          perOutcome.set(o.key, arr);
        });
        counted++;
      }
      if (counted < minBooks) continue;

      for (const o of v.outcomes) {
        const samples = perOutcome.get(o.key);
        if (!samples || samples.length < minBooks) continue;
        const fairProb = samples.reduce((a, x) => a + x, 0) / samples.length;
        if (fairProb <= 0.02 || fairProb >= 0.99) continue;
        out.push({
          eventId: ev.id,
          sport: ev.sport,
          league: ev.league,
          match: `${ev.home} — ${ev.away}`,
          startTime: ev.startTime,
          live: ev.live,
          market: v.market,
          marketLabel: v.label,
          outcome: o.label,
          book: o.best.book,
          bookKey: o.best.bookKey,
          url: o.best.url,
          price: o.best.price,
          fairProb,
          booksCount: samples.length,
        });
      }
    }
  }
  return out;
}

const toExpress = (legs: Candidate[]): Express => {
  const totalOdds = legs.reduce((a, l) => a * l.price, 1);
  const prob = legs.reduce((a, l) => a * l.fairProb, 1);
  return {
    legs: [...legs].sort((a, b) => +new Date(a.startTime) - +new Date(b.startTime)),
    totalOdds,
    guaranteedPct: prob * 100,
    minLegProbPct: Math.min(...legs.map((l) => l.fairProb)) * 100,
    payout100: 100 * totalOdds,
    profit100: 100 * (totalOdds - 1),
  };
};

/**
 * Сборка экспрессов: берём самые вероятные ноги из разных матчей и
 * переставляем их так, чтобы произведение вероятностей осталось не ниже
 * запрошенной гарантии.
 */
export function buildExpresses(events: MergedEvent[], opts: ExpressOptions = {}): ExpressResult {
  const minGuaranteePct = clamp(opts.minGuaranteePct ?? 80, 1, 99.9);
  const minLegs = clamp(Math.floor(opts.minLegs ?? 2), 2, 8);
  const maxLegs = clamp(Math.floor(opts.maxLegs ?? 5), minLegs, 8);
  const minLegProb = clamp(opts.minLegProb ?? 0.5, 0.1, 0.99);
  const maxLegProb = clamp(opts.maxLegProb ?? 0.98, minLegProb + 0.01, 0.995);
  const minLegOdds = opts.minLegOdds ?? 1.05;
  const minTotalOdds = opts.minTotalOdds ?? 1.1;
  const maxTotalOdds = opts.maxTotalOdds ?? 30;
  const minBooks = Math.max(2, Math.floor(opts.minBooks ?? 3));
  const method = opts.method ?? "shin";
  const limit = clamp(Math.floor(opts.limit ?? 24), 1, 100);

  const stats: ExpressStats = {
    eventsScanned: events.length,
    comparable: events.filter((e) => e.books.length >= minBooks).length,
    candidateLegs: 0,
    combosChecked: 0,
  };

  const legs = candidateLegs(events, method, minBooks).filter(
    (l) => l.fairProb >= minLegProb && l.fairProb <= maxLegProb && l.price >= minLegOdds
  );
  stats.candidateLegs = legs.length;
  if (!legs.length || minLegs > maxLegs) return { expresses: [], nearMisses: [], stats };

  // по каждому матчу — до 3 лучших ног (по вероятности, при равенстве — по цене)
  const byEvent = new Map<string, Candidate[]>();
  for (const l of legs) {
    const arr = byEvent.get(l.eventId) || [];
    arr.push(l);
    byEvent.set(l.eventId, arr);
  }
  const ranked = [...byEvent.values()]
    .map((arr) => arr.sort((a, b) => b.fairProb - a.fairProb || b.price - a.price).slice(0, 3))
    .sort((a, b) => b[0].fairProb - a[0].fairProb || b[0].price - a[0].price);

  const seen = new Set<string>();
  const combos: Candidate[][] = [];
  const push = (cs: Candidate[]) => {
    if (cs.length < minLegs || cs.length > maxLegs) return;
    if (new Set(cs.map((c) => c.eventId)).size !== cs.length) return;
    const key = cs
      .map((c) => `${c.eventId}|${c.market}|${c.outcome}`)
      .sort()
      .join(";");
    if (seen.has(key)) return;
    seen.add(key);
    combos.push(cs);
  };

  for (let L = minLegs; L <= maxLegs; L++) {
    if (ranked.length < L) break;
    // базовый экспресс: топ-L матчей по их лучшей ноге
    push(ranked.slice(0, L).map((a) => a[0]));
    // вариант: самая слабая нога заменена следующим матчем в рейтинге
    for (let k = L; k < Math.min(L + 4, ranked.length); k++) {
      push([...ranked.slice(0, L - 1).map((a) => a[0]), ranked[k][0]]);
    }
    // вариант: нога заменена резервным исходом того же матча
    const base = ranked.slice(0, L).map((a) => a[0]);
    for (let i = 0; i < L; i++) {
      for (const alt of ranked[i].slice(1)) {
        push(base.map((b, j) => (j === i ? alt : b)));
      }
    }
  }

  const all: Express[] = [];
  for (const cs of combos) {
    stats.combosChecked++;
    const ex = toExpress(cs);
    if (ex.totalOdds < minTotalOdds || ex.totalOdds > maxTotalOdds) continue;
    all.push(ex);
  }

  all.sort((a, b) => b.guaranteedPct - a.guaranteedPct || b.totalOdds - a.totalOdds);

  const expresses = all.filter((e) => e.guaranteedPct >= minGuaranteePct).slice(0, limit);
  const nearMisses = all.filter((e) => e.guaranteedPct < minGuaranteePct).slice(0, 3);
  return { expresses, nearMisses, stats };
}
