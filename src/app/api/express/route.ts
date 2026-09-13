import { NextResponse } from "next/server";
import { fetchAllBooks, mergeEvents } from "@/lib/books";
import { buildExpresses } from "@/lib/books/express";
import { BOOK_LIST, SPORTS, type SportKey } from "@/lib/books/types";
import { fail, NO_BOOKS_HINT, sourceView, withNetwork } from "../_util";

export const dynamic = "force-dynamic";

/** сколько событий одного вида спорта отдаём в сборку (прематч-фид большой — режем) */
const MAX_EVENTS_PER_SPORT = 400;

const int = (sp: URLSearchParams, k: string, d: number) => {
  const v = Number(sp.get(k));
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : d;
};
const float = (sp: URLSearchParams, k: string, d: number) => {
  const v = Number(sp.get(k));
  return Number.isFinite(v) ? v : d;
};

/**
 * Экспрессы под Винлайн.
 *
 * Winline публичного фида не имеет, поэтому ноги собираются из лучшей цены
 * рынка (лучшая среди контор сканера), а гарантия — из консенсуса
 * справедливых вероятностей. Параметры:
 *   sports, books, minGuarantee(80), minLegs(2), maxLegs(5),
 *   minLegProb(0.5), minLegOdds(1.05), minTotalOdds(1.1), maxTotalOdds(30),
 *   minBooks(3), method(shin), days(3), live(0/1), limit(24), dns
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const sports = (sp.get("sports") || "football")
    .split(",")
    .filter((s): s is SportKey => SPORTS.some((x) => x.key === s));
  const books = (sp.get("books") || BOOK_LIST.map((b) => b.key).join(","))
    .split(",")
    .filter(Boolean);
  const minGuarantee = float(sp, "minGuarantee", 80);
  const minLegs = int(sp, "minLegs", 2);
  const maxLegs = int(sp, "maxLegs", 5);
  const minLegProb = float(sp, "minLegProb", 0.5);
  const minLegOdds = float(sp, "minLegOdds", 1.05);
  const minTotalOdds = float(sp, "minTotalOdds", 1.1);
  const maxTotalOdds = float(sp, "maxTotalOdds", 30);
  const minBooks = int(sp, "minBooks", 3);
  const method = (sp.get("method") as "shin" | "multiplicative") || "shin";
  const days = float(sp, "days", 3);
  const live = sp.get("live") === "1";
  const limit = int(sp, "limit", 24);

  return withNetwork(req, async () => {
    try {
      const perSport = await Promise.all(
        sports.slice(0, SPORTS.length).map(async (s) => {
          const results = await fetchAllBooks(s, books);
          let merged = mergeEvents(results);
          if (live) merged = merged.filter((m) => m.live);
          else merged = merged.filter((m) => !m.live);
          if (days > 0) {
            const until = Date.now() + days * 24 * 60 * 60 * 1000;
            merged = merged.filter((m) => +new Date(m.startTime) <= until);
          }
          return { results, merged: merged.slice(0, MAX_EVENTS_PER_SPORT) };
        })
      );
      const merged = perSport.flatMap((p) => p.merged);
      const anyOk = perSport.some((p) => p.results.some((r) => r.ok && r.events.length));
      const sources = perSport[0]?.results ?? [];

      const res = buildExpresses(merged, {
        minGuaranteePct: minGuarantee,
        minLegs,
        maxLegs,
        minLegProb,
        minLegOdds,
        minTotalOdds,
        maxTotalOdds,
        minBooks,
        method,
        limit,
      });

      return NextResponse.json({
        expresses: res.expresses,
        nearMisses: res.nearMisses,
        stats: res.stats,
        minGuaranteePct: minGuarantee,
        sources: sources.map(sourceView),
        hint: anyOk ? undefined : NO_BOOKS_HINT,
        fetchedAt: new Date().toISOString(),
      });
    } catch (e) {
      return fail(e);
    }
  });
}
