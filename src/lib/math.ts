import type { ArbOpportunity, BestPrice, Event, ValueBet } from "./types";

export const MARKET_LABELS: Record<string, string> = {
  h2h: "Исход (1X2 / ML)",
  spreads: "Фора",
  totals: "Тотал",
  outrights: "Аутрайт",
  h2h_lay: "Лей (биржа)",
  btts: "Обе забьют",
  draw_no_bet: "Ничья — возврат",
};

export const marketLabel = (k: string) => MARKET_LABELS[k] ?? k;

export const impliedProb = (decimalOdds: number) => (decimalOdds > 0 ? 1 / decimalOdds : 0);

export function decimalToAmerican(d: number): number {
  if (d >= 2) return Math.round((d - 1) * 100);
  return Math.round(-100 / (d - 1));
}

export function decimalToFractional(d: number): string {
  const v = d - 1;
  let bestN = 1;
  let bestD = 1;
  let bestErr = Infinity;
  for (let den = 1; den <= 50; den++) {
    const numr = Math.round(v * den);
    const err = Math.abs(v - numr / den);
    if (err < bestErr - 1e-12) {
      bestErr = err;
      bestN = numr;
      bestD = den;
    }
  }
  return `${bestN}/${bestD}`;
}

/** Удаление маржи методом мультипликативной нормализации */
export function normalizeProbs(prices: number[]): number[] {
  const raw = prices.map(impliedProb);
  const sum = raw.reduce((a, b) => a + b, 0);
  return sum > 0 ? raw.map((p) => p / sum) : raw;
}

/**
 * Удаление маржи методом Shin — устойчивее к фаворит-лонгшот bias.
 */
export function shinProbs(prices: number[]): number[] {
  const raw = prices.map(impliedProb);
  const sum = raw.reduce((a, b) => a + b, 0);
  if (sum <= 0) return raw;
  if (prices.length < 2) return raw.map((p) => p / sum);

  // Бинарный поиск z ∈ [0, 0.4): сумма π(z) монотонно убывает по z
  const totalAt = (z: number) =>
    raw.reduce((acc, p) => acc + shinPi(p, sum, z), 0);
  let lo = 0;
  let hi = 0.4;
  if (totalAt(lo) <= 1) {
    return raw.map((p) => p / sum);
  }
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (totalAt(mid) > 1) lo = mid;
    else hi = mid;
  }
  const z = (lo + hi) / 2;
  const probs = raw.map((p) => shinPi(p, sum, z));
  const total = probs.reduce((a, b) => a + b, 0);
  return total > 0 ? probs.map((p) => p / total) : raw.map((p) => p / sum);
}

function shinPi(pi: number, sum: number, z: number): number {
  const inner = z * z + 4 * (1 - z) * ((pi * pi) / sum);
  return (Math.sqrt(Math.max(inner, 0)) - z) / (2 * (1 - z || 1e-9));
}

export const bookmakerMargin = (prices: number[]) =>
  prices.reduce((a, p) => a + impliedProb(p), 0) - 1;

/** Kelly: доля банка при цене odds и оценке вероятности p */
export function kellyFraction(odds: number, p: number): number {
  const b = odds - 1;
  if (b <= 0) return 0;
  const f = (b * p - (1 - p)) / b;
  return Math.max(0, f);
}

export function expectedValue(odds: number, p: number, stake = 100): number {
  return stake * (p * (odds - 1) - (1 - p));
}

/** Ключ исхода с учётом линии (для фор/тоталов) */
const outcomeKey = (name: string, point?: number) =>
  point === undefined || point === null ? name : `${name}@${point}`;

/** Лучшие цены по каждому исходу рынка среди всех букмекеров */
export function bestPrices(event: Event, marketKey: string): BestPrice[] {
  const map = new Map<string, BestPrice>();
  for (const bk of event.bookmakers || []) {
    const m = bk.markets?.find((x) => x.key === marketKey);
    if (!m) continue;
    for (const o of m.outcomes || []) {
      const key = outcomeKey(o.name, o.point);
      const entry = map.get(key);
      const priceRec = { bookmaker: bk.title, bookmakerKey: bk.key, price: o.price };
      if (!entry) {
        map.set(key, {
          outcome: o.name,
          point: o.point,
          price: o.price,
          bookmaker: bk.title,
          bookmakerKey: bk.key,
          allPrices: [priceRec],
        });
      } else {
        entry.allPrices.push(priceRec);
        if (o.price > entry.price) {
          entry.price = o.price;
          entry.bookmaker = bk.title;
          entry.bookmakerKey = bk.key;
        }
      }
    }
  }
  return [...map.values()];
}

/** Набор исходов рынка (для h2h — стороны, для totals/spreads — по линии) */
function marketGroups(event: Event, marketKey: string): Map<string, BestPrice[]> {
  const best = bestPrices(event, marketKey);
  const groups = new Map<string, BestPrice[]>();
  for (const b of best) {
    const g = marketKey === "h2h" ? "main" : String(b.point ?? "main");
    // Для spreads линия зеркальная (+2.5 / -2.5) — группируем по модулю
    const gk = marketKey === "spreads" ? String(Math.abs(b.point ?? 0)) : g;
    const arr = groups.get(gk) || [];
    arr.push(b);
    groups.set(gk, arr);
  }
  return groups;
}

export function findArbs(events: Event[], markets: string[], minProfit = 0): ArbOpportunity[] {
  const out: ArbOpportunity[] = [];
  for (const ev of events) {
    for (const mk of markets) {
      for (const [, legsRaw] of marketGroups(ev, mk)) {
        const legs = dedupeSides(legsRaw, mk);
        if (legs.length < 2 || legs.length > 3) continue;
        const totalImplied = legs.reduce((a, l) => a + impliedProb(l.price), 0);
        if (totalImplied <= 0) continue;
        const profitPct = (1 / totalImplied - 1) * 100;
        if (profitPct < minProfit || profitPct > 40) continue; // >40% — почти всегда битая линия
        out.push({
          eventId: ev.id,
          sportKey: ev.sport_key,
          sportTitle: ev.sport_title,
          commenceTime: ev.commence_time,
          match: `${ev.home_team} — ${ev.away_team}`,
          market: mk,
          marketLabel: marketLabel(mk),
          totalImplied,
          profitPct,
          legs: legs.map((l) => ({
            outcome: l.outcome,
            point: l.point,
            price: l.price,
            bookmaker: l.bookmaker,
            stakeShare: impliedProb(l.price) / totalImplied,
          })),
        });
      }
    }
  }
  return out.sort((a, b) => b.profitPct - a.profitPct);
}

/** Для spreads/totals оставляем ровно две противоположные стороны */
function dedupeSides(legs: BestPrice[], marketKey: string): BestPrice[] {
  if (marketKey === "h2h") return legs;
  const byName = new Map<string, BestPrice>();
  for (const l of legs) {
    const prev = byName.get(l.outcome);
    if (!prev || l.price > prev.price) byName.set(l.outcome, l);
  }
  return [...byName.values()];
}

export type ValueOptions = {
  minEdgePct?: number;
  minBooks?: number;
  method?: "shin" | "multiplicative";
  sharpBooks?: string[];
};

/**
 * Value-беты: справедливая вероятность = консенсус рынка (среднее по букмекерам
 * после удаления маржи), сравнивается с лучшей доступной ценой.
 */
export function findValueBets(
  events: Event[],
  markets: string[],
  opts: ValueOptions = {}
): ValueBet[] {
  const minEdge = opts.minEdgePct ?? 2;
  const minBooks = opts.minBooks ?? 4;
  const method = opts.method ?? "shin";
  const sharp = new Set((opts.sharpBooks ?? []).map((s) => s.toLowerCase()));
  const out: ValueBet[] = [];

  for (const ev of events) {
    for (const mk of markets) {
      // консенсус: по каждому букмекеру убираем маржу, затем усредняем
      const perOutcome = new Map<string, number[]>();
      let booksCount = 0;
      for (const bk of ev.bookmakers || []) {
        if (sharp.size && !sharp.has(bk.key.toLowerCase())) continue;
        const m = bk.markets?.find((x) => x.key === mk);
        if (!m || !m.outcomes?.length) continue;
        const groups = new Map<string, typeof m.outcomes>();
        for (const o of m.outcomes) {
          const gk = mk === "h2h" ? "main" : String(Math.abs(o.point ?? 0));
          const arr = groups.get(gk) || [];
          arr.push(o);
          groups.set(gk, arr);
        }
        let counted = false;
        for (const [gk, outs] of groups) {
          if (outs.length < 2) continue;
          const probs =
            method === "shin"
              ? shinProbs(outs.map((o) => o.price))
              : normalizeProbs(outs.map((o) => o.price));
          outs.forEach((o, i) => {
            const key = `${gk}|${o.name}`;
            const arr = perOutcome.get(key) || [];
            arr.push(probs[i]);
            perOutcome.set(key, arr);
          });
          counted = true;
        }
        if (counted) booksCount++;
      }
      if (booksCount < minBooks) continue;

      for (const b of bestPrices(ev, mk)) {
        const gk = mk === "h2h" ? "main" : String(Math.abs(b.point ?? 0));
        const samples = perOutcome.get(`${gk}|${b.outcome}`);
        if (!samples || samples.length < minBooks) continue;
        const fairProb = samples.reduce((a, x) => a + x, 0) / samples.length;
        if (fairProb <= 0.005 || fairProb >= 0.995) continue;
        const fairPrice = 1 / fairProb;
        const edgePct = (b.price / fairPrice - 1) * 100;
        if (edgePct < minEdge || edgePct > 60) continue;
        out.push({
          eventId: ev.id,
          sportKey: ev.sport_key,
          sportTitle: ev.sport_title,
          commenceTime: ev.commence_time,
          match: `${ev.home_team} — ${ev.away_team}`,
          market: mk,
          marketLabel: marketLabel(mk),
          outcome: b.outcome,
          point: b.point,
          bookmaker: b.bookmaker,
          price: b.price,
          fairPrice,
          fairProb,
          edgePct,
          evPer100: expectedValue(b.price, fairProb, 100),
          kelly: kellyFraction(b.price, fairProb),
          booksCount: samples.length,
        });
      }
    }
  }
  return out.sort((a, b) => b.edgePct - a.edgePct);
}

/** Расчёт ставок арбитража под заданный банк */
export function arbStakes(legs: { price: number }[], total: number) {
  const inv = legs.map((l) => 1 / l.price);
  const sum = inv.reduce((a, b) => a + b, 0);
  return legs.map((l, i) => {
    const stake = (total * inv[i]) / sum;
    return { stake, payout: stake * l.price, profit: stake * l.price - total };
  });
}

/** Дач-беттинг: равная прибыль на N исходов */
export const dutch = arbStakes;

export function parlayOdds(odds: number[]): number {
  return odds.reduce((a, b) => a * b, 1);
}

export function hedgeStake(originalOdds: number, originalStake: number, hedgeOdds: number) {
  const stake = (originalOdds * originalStake) / hedgeOdds;
  const payout = stake * hedgeOdds;
  return {
    stake,
    guaranteed: payout - (originalStake + stake),
    payout,
  };
}

/** Poisson-модель футбольного матча по ожидаемым голам */
export function poissonMatrix(lambdaHome: number, lambdaAway: number, maxGoals = 10) {
  const pois = (l: number, k: number) =>
    (Math.exp(-l) * Math.pow(l, k)) / factorial(k);
  const m: number[][] = [];
  for (let i = 0; i <= maxGoals; i++) {
    const row: number[] = [];
    for (let j = 0; j <= maxGoals; j++) row.push(pois(lambdaHome, i) * pois(lambdaAway, j));
    m.push(row);
  }
  return m;
}

function factorial(n: number): number {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

export function poissonMarkets(lh: number, la: number) {
  const m = poissonMatrix(lh, la);
  let home = 0;
  let draw = 0;
  let away = 0;
  let btts = 0;
  const totals: Record<string, number> = {};
  const lines = [0.5, 1.5, 2.5, 3.5, 4.5];
  const correct: { score: string; p: number }[] = [];
  for (let i = 0; i < m.length; i++) {
    for (let j = 0; j < m[i].length; j++) {
      const p = m[i][j];
      if (i > j) home += p;
      else if (i === j) draw += p;
      else away += p;
      if (i > 0 && j > 0) btts += p;
      for (const L of lines) if (i + j > L) totals[`over${L}`] = (totals[`over${L}`] || 0) + p;
      if (i <= 5 && j <= 5) correct.push({ score: `${i}:${j}`, p });
    }
  }
  correct.sort((a, b) => b.p - a.p);
  return { home, draw, away, btts, totals, topScores: correct.slice(0, 8) };
}

/** Расчёт метрик банкролла по списку ставок */
export function bankrollStats(
  bets: {
    stake: number;
    odds: number;
    status: string;
    cashoutReturn?: number;
    createdAt: string;
  }[]
) {
  let staked = 0;
  let ret = 0;
  let won = 0;
  let lost = 0;
  let pending = 0;
  const curve: { i: number; pnl: number; date: string }[] = [];
  const sorted = [...bets].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
  let running = 0;
  sorted.forEach((b, i) => {
    if (b.status === "pending") {
      pending++;
      return;
    }
    staked += b.stake;
    let r = 0;
    if (b.status === "won") {
      r = b.stake * b.odds;
      won++;
    } else if (b.status === "void") r = b.stake;
    else if (b.status === "cashout") r = b.cashoutReturn ?? b.stake;
    else lost++;
    ret += r;
    running += r - b.stake;
    curve.push({ i: i + 1, pnl: Number(running.toFixed(2)), date: b.createdAt });
  });
  const settled = won + lost;
  const profit = ret - staked;
  return {
    staked,
    returned: ret,
    profit,
    roi: staked > 0 ? (profit / staked) * 100 : 0,
    winRate: settled > 0 ? (won / settled) * 100 : 0,
    won,
    lost,
    pending,
    count: bets.length,
    curve,
    avgOdds: bets.length ? bets.reduce((a, b) => a + b.odds, 0) / bets.length : 0,
  };
}

/** Оценка CLV: закрывающая цена против взятой */
export function clv(takenOdds: number, closingOdds: number): number {
  return (takenOdds / closingOdds - 1) * 100;
}
