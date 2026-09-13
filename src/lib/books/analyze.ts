import type { BestOutcome, MarketView, MergedEvent, PriceRef } from "./types";
import { bookmakerMargin, impliedProb, shinProbs, normalizeProbs, kellyFraction, expectedValue } from "../math";

/** Собирает по объединённому событию лучшие цены на каждый исход */
export function marketViews(ev: MergedEvent, method: "shin" | "multiplicative" = "shin"): MarketView[] {
  const views: MarketView[] = [];

  const build = (
    market: string,
    label: string,
    picks: { key: string; label: string; get: (b: MergedEvent["books"][number]) => number | undefined }[]
  ) => {
    const outcomes: BestOutcome[] = [];
    for (const p of picks) {
      const all: PriceRef[] = [];
      for (const b of ev.books) {
        const price = p.get(b);
        if (price && price > 1) all.push({ book: b.bookTitle, bookKey: b.bookKey, price, url: b.url });
      }
      if (!all.length) continue;
      all.sort((x, y) => y.price - x.price);
      outcomes.push({ key: p.key, label: p.label, best: all[0], all });
    }
    if (outcomes.length < 2) return;
    const prices = outcomes.map((o) => o.best.price);
    const fair = method === "shin" ? shinProbs(prices) : normalizeProbs(prices);
    outcomes.forEach((o, i) => (o.fairProb = fair[i]));
    views.push({
      market,
      label,
      outcomes,
      overround: bookmakerMargin(prices) * 100,
    });
  };

  const hasDraw = ev.books.some((b) => b.markets.moneyline?.draw);
  build("moneyline", "Исход матча", [
    { key: "1", label: `П1 — ${ev.home}`, get: (b) => b.markets.moneyline?.home },
    ...(hasDraw ? [{ key: "X", label: "Ничья", get: (b: any) => b.markets.moneyline?.draw }] : []),
    { key: "2", label: `П2 — ${ev.away}`, get: (b) => b.markets.moneyline?.away },
  ]);

  if (hasDraw) {
    build("doubleChance", "Двойной шанс", [
      { key: "1X", label: "1X", get: (b) => b.markets.doubleChance?.homeDraw },
      { key: "12", label: "12", get: (b) => b.markets.doubleChance?.homeAway },
      { key: "X2", label: "X2", get: (b) => b.markets.doubleChance?.drawAway },
    ]);
  }

  build("btts", "Обе забьют", [
    { key: "yes", label: "Да", get: (b) => b.markets.btts?.yes },
    { key: "no", label: "Нет", get: (b) => b.markets.btts?.no },
  ]);

  // тоталы по каждой линии
  const totalLines = new Set<number>();
  ev.books.forEach((b) => b.markets.totals?.forEach((t) => totalLines.add(t.line)));
  for (const line of [...totalLines].sort((a, b) => a - b)) {
    build(`total_${line}`, `Тотал ${line}`, [
      { key: `over${line}`, label: `Больше ${line}`, get: (b) => b.markets.totals?.find((t) => t.line === line)?.over },
      { key: `under${line}`, label: `Меньше ${line}`, get: (b) => b.markets.totals?.find((t) => t.line === line)?.under },
    ]);
  }

  // форы
  const hcapLines = new Set<number>();
  ev.books.forEach((b) => b.markets.handicaps?.forEach((h) => hcapLines.add(h.line)));
  for (const line of [...hcapLines].sort((a, b) => a - b)) {
    const s = line > 0 ? `+${line}` : String(line);
    build(`hcap_${line}`, `Фора ${s}`, [
      { key: `h1${line}`, label: `${ev.home} ${s}`, get: (b) => b.markets.handicaps?.find((h) => h.line === line)?.home },
      {
        key: `h2${line}`,
        label: `${ev.away} ${line > 0 ? `−${line}` : `+${Math.abs(line)}`}`,
        get: (b) => b.markets.handicaps?.find((h) => h.line === line)?.away,
      },
    ]);
  }

  return views;
}

export type RuArb = {
  eventId: string;
  sport: string;
  league: string;
  match: string;
  startTime: string;
  live: boolean;
  market: string;
  marketLabel: string;
  profitPct: number;
  totalImplied: number;
  legs: { label: string; price: number; book: string; bookKey: string; url?: string; share: number }[];
};

/** Поиск вилок между российскими конторами */
export function findRuArbs(events: MergedEvent[], minProfit = 0): RuArb[] {
  const out: RuArb[] = [];
  for (const ev of events) {
    if (ev.books.length < 2) continue;
    for (const v of marketViews(ev)) {
      // вилка возможна только если исходы взяты у разных контор
      const totalImplied = v.outcomes.reduce((a, o) => a + impliedProb(o.best.price), 0);
      const profit = (1 / totalImplied - 1) * 100;
      if (profit < minProfit || profit > 30) continue;
      const distinct = new Set(v.outcomes.map((o) => o.best.bookKey));
      if (distinct.size < 2) continue;
      out.push({
        eventId: ev.id,
        sport: ev.sport,
        league: ev.league,
        match: `${ev.home} — ${ev.away}`,
        startTime: ev.startTime,
        live: ev.live,
        market: v.market,
        marketLabel: v.label,
        profitPct: profit,
        totalImplied,
        legs: v.outcomes.map((o) => ({
          label: o.label,
          price: o.best.price,
          book: o.best.book,
          bookKey: o.best.bookKey,
          url: o.best.url,
          share: impliedProb(o.best.price) / totalImplied,
        })),
      });
    }
  }
  return out.sort((a, b) => b.profitPct - a.profitPct);
}

export type RuValue = {
  eventId: string;
  sport: string;
  league: string;
  match: string;
  startTime: string;
  live: boolean;
  market: string;
  marketLabel: string;
  outcome: string;
  book: string;
  bookKey: string;
  url?: string;
  price: number;
  fairPrice: number;
  fairProb: number;
  edgePct: number;
  evPer100: number;
  kelly: number;
  booksCount: number;
};

/**
 * Value: справедливая вероятность — консенсус российских контор
 * (у каждой снимается маржа, затем усреднение), сравнивается с лучшей ценой.
 */
export function findRuValue(
  events: MergedEvent[],
  opts: { minEdge?: number; minBooks?: number; method?: "shin" | "multiplicative" } = {}
): RuValue[] {
  const minEdge = opts.minEdge ?? 2;
  const minBooks = opts.minBooks ?? 3;
  const method = opts.method ?? "shin";
  const out: RuValue[] = [];

  for (const ev of events) {
    if (ev.books.length < minBooks) continue;
    for (const v of marketViews(ev, method)) {
      // по каждой конторе отдельно снимаем маржу и усредняем вероятности
      const perOutcome = new Map<string, number[]>();
      let counted = 0;
      for (const b of ev.books) {
        const prices = v.outcomes.map((o) => o.all.find((p) => p.bookKey === b.bookKey)?.price);
        if (prices.some((p) => !p)) continue;
        const probs =
          method === "shin"
            ? shinProbs(prices as number[])
            : normalizeProbs(prices as number[]);
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
        const fairProb = samples.reduce((a, b) => a + b, 0) / samples.length;
        if (fairProb <= 0.01 || fairProb >= 0.99) continue;
        const fairPrice = 1 / fairProb;
        const edge = (o.best.price / fairPrice - 1) * 100;
        if (edge < minEdge || edge > 50) continue;
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
          fairPrice,
          fairProb,
          edgePct: edge,
          evPer100: expectedValue(o.best.price, fairProb, 100),
          kelly: kellyFraction(o.best.price, fairProb),
          booksCount: samples.length,
        });
      }
    }
  }
  return out.sort((a, b) => b.edgePct - a.edgePct);
}
