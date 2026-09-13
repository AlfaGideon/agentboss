import type { BookAdapter, BookEvent, BookFetchResult, MergedEvent, SportKey } from "./types";
import { similarity, normTeam } from "./http";
import { fonbet } from "./fonbet";
import { ligastavok } from "./ligastavok";
import { winline } from "./winline";
import { olimp } from "./olimp";
import { betboom, marathon, pari, zenit } from "./more-books";

export const ADAPTERS: BookAdapter[] = [
  fonbet,
  ligastavok,
  winline,
  olimp,
  betboom,
  marathon,
  pari,
  zenit,
];

export const BOOKS = ADAPTERS.map((a) => ({ key: a.key, title: a.title, site: a.site }));

export const bookTitle = (key: string) => ADAPTERS.find((a) => a.key === key)?.title ?? key;

/** Опрос выбранных контор параллельно, с таймаутом на каждую */
export async function fetchAllBooks(
  sport: SportKey,
  bookKeys: string[],
  timeoutMs = 25000
): Promise<BookFetchResult[]> {
  const chosen = ADAPTERS.filter((a) => bookKeys.includes(a.key));
  return Promise.all(
    chosen.map(async (a): Promise<BookFetchResult> => {
      const t0 = Date.now();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const { events, endpoint, rawCount } = await a.fetchLine(sport, ctrl.signal);
        return {
          bookKey: a.key,
          bookTitle: a.title,
          ok: true,
          events,
          endpoint,
          rawCount,
          ms: Date.now() - t0,
        };
      } catch (e) {
        const msg =
          e instanceof Error
            ? e.name === "AbortError"
              ? `Таймаут ${Math.round(timeoutMs / 1000)} с`
              : e.message
            : "Неизвестная ошибка";
        return {
          bookKey: a.key,
          bookTitle: a.title,
          ok: false,
          events: [],
          error: msg,
          ms: Date.now() - t0,
        };
      } finally {
        clearTimeout(timer);
      }
    })
  );
}

const TIME_WINDOW_MS = 3 * 60 * 60 * 1000; // матч считается тем же в пределах 3 часов

/**
 * Сопоставление событий разных контор: одна и та же пара команд
 * с близким временем начала объединяется в одно событие.
 */
export function mergeEvents(results: BookFetchResult[]): MergedEvent[] {
  const merged: MergedEvent[] = [];

  const all = results.flatMap((r) => r.events);
  // сначала события конторы с самой полной линией — будут «якорями»
  const order = [...results].sort((a, b) => b.events.length - a.events.length);
  const ordered = order.flatMap((r) => r.events);

  for (const ev of ordered) {
    const t = +new Date(ev.startTime);
    let target: MergedEvent | undefined;
    let bestScore = 0;

    for (const m of merged) {
      if (m.sport !== ev.sport) continue;
      if (Math.abs(+new Date(m.startTime) - t) > TIME_WINDOW_MS) continue;
      if (m.books.some((b) => b.bookKey === ev.bookKey)) continue;

      const direct = (similarity(m.home, ev.home) + similarity(m.away, ev.away)) / 2;
      const swapped = (similarity(m.home, ev.away) + similarity(m.away, ev.home)) / 2;
      const score = Math.max(direct, swapped);
      if (score > bestScore && score >= 0.72) {
        bestScore = score;
        target = m;
        // если команды перевёрнуты — переворачиваем котировки
        if (swapped > direct) {
          ev.markets = flipMarkets(ev.markets);
          const h = ev.home;
          ev.home = ev.away;
          ev.away = h;
        }
      }
    }

    if (target) {
      target.books.push(ev);
      if (!target.league && ev.league) target.league = ev.league;
    } else {
      merged.push({
        id: `${ev.sport}:${normTeam(ev.home)}-${normTeam(ev.away)}:${ev.startTime.slice(0, 13)}`,
        sport: ev.sport,
        league: ev.league,
        home: ev.home,
        away: ev.away,
        startTime: ev.startTime,
        live: ev.live,
        books: [ev],
      });
    }
  }

  void all;
  return merged.sort((a, b) => +new Date(a.startTime) - +new Date(b.startTime));
}

/** Переворот рынков при смене хозяев и гостей местами */
function flipMarkets(m: BookEvent["markets"]): BookEvent["markets"] {
  return {
    moneyline: m.moneyline
      ? { home: m.moneyline.away, draw: m.moneyline.draw, away: m.moneyline.home }
      : undefined,
    doubleChance: m.doubleChance
      ? {
          homeDraw: m.doubleChance.drawAway,
          homeAway: m.doubleChance.homeAway,
          drawAway: m.doubleChance.homeDraw,
        }
      : undefined,
    btts: m.btts,
    totals: m.totals,
    handicaps: m.handicaps?.map((h) => ({ line: -h.line, home: h.away, away: h.home })),
  };
}
